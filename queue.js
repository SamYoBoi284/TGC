// ===========================================
// RelayDesk
// queue.js
// Firestore Activity Queue (offline-first write sync)
// ===========================================
//
// PURPOSE
// -------
// Data-changing actions (notes, loads, chat messages, shift status,
// end-of-shift reports) are never written to Firestore directly.
// They're pushed into a local queue first, persisted to
// localStorage, and drained in order (FIFO) whenever we believe
// we're online. This means a flaky connection never loses a user's
// work — the UI stays responsive and the write just waits.
//
// NOT queued (still immediate, per spec):
//   login/logout, permission changes, admin/account creation,
//   role changes. Those files call db.* directly, same as before.
//
// PUBLIC API
// ----------
//   RelayDesk.queue.enqueue(type, payload, { dedupeKey } = {})
//   RelayDesk.queue.registerHandler(type, async (payload) => {...})
//   RelayDesk.queue.pendingCount()
//   RelayDesk.queue.newId()          -> for generating Firestore doc ids
//                                       client-side (works offline)
//
// Built-in types: SAVE_NOTES, EDIT_LOAD, DELETE_LOAD,
// CHAT_MESSAGE, DELETE_CHAT_MESSAGE, DELETE_CHAT, FIRESTORE_MERGE
// (generic escape hatch for anything else — e.g. shift status
// updates, end-of-shift report submission — pass
// { collection, docId, data }).
//
// ADD_LOAD is NOT queued (as of the fix below) — see workspace.js's
// saveLoad()/saveLoadDirect() for why: queued writes drain strictly
// in order and stop on the first failure, which was silently
// blocking new employees' booked loads from ever reaching
// shiftHistory.

(function () {

    if (!window.RelayDesk) window.RelayDesk = {};

    const STORAGE_KEY = "relaydesk_activity_queue_v1";

    const BASE_RETRY_MS = 3000;
    const MAX_RETRY_MS = 30000;

    const Queue = {
        items: [],
        handlers: {},
        isSyncing: false,
        assumedOffline: false,
        retryDelay: BASE_RETRY_MS,
        retryTimer: null,
        UI: {}
    };

    // ===========================================
    // PERSISTENCE
    // ===========================================

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Queue.items));
        } catch (e) {
            console.warn("⚠️ Queue: failed to persist to localStorage", e);
        }
    }

    function restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            Queue.items = raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn("⚠️ Queue: failed to restore from localStorage", e);
            Queue.items = [];
        }
    }

    // ===========================================
    // ID GENERATION (works fully offline)
    // ===========================================

    Queue.newId = function () {
        if (window.crypto?.randomUUID) return crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };

    // Firestore can mint a real document id locally without a network
    // round trip — use this whenever a queued write needs a doc id
    // up front (e.g. chat messages) so retries hit the same doc.
    Queue.newFirestoreId = function (collectionRef) {
        try {
            return collectionRef.doc().id;
        } catch (e) {
            return Queue.newId();
        }
    };

    // ===========================================
    // ENQUEUE
    // ===========================================
    //
    // dedupeKey: if provided, replaces any existing PENDING item with
    // the same (type, dedupeKey) instead of adding a new one. Used
    // for things like notes autosave, where only the latest value
    // matters and we don't want to replay every keystroke.

    Queue.enqueue = function (type, payload, opts = {}) {

        const { dedupeKey } = opts;

        if (dedupeKey) {
            const existingIdx = Queue.items.findIndex(i =>
                i.type === type &&
                i.dedupeKey === dedupeKey &&
                i.status === "pending"
            );

            if (existingIdx !== -1) {
                Queue.items[existingIdx].payload = payload;
                Queue.items[existingIdx].timestamp = Date.now();
                persist();
                updateStatusUI();
                kickSync();
                return Queue.items[existingIdx].id;
            }
        }

        const item = {
            id: Queue.newId(),
            type,
            payload,
            dedupeKey: dedupeKey || null,
            timestamp: Date.now(),
            status: "pending",
            attempts: 0
        };

        Queue.items.push(item);
        persist();
        updateStatusUI();
        kickSync();

        return item.id;
    };

    Queue.pendingCount = function () {
        return Queue.items.filter(i => i.status !== "done").length;
    };

    Queue.registerHandler = function (type, fn) {
        Queue.handlers[type] = fn;
    };

    // ===========================================
    // BUILT-IN HANDLERS (idempotent — safe to retry)
    // ===========================================

    Queue.registerHandler("SAVE_NOTES", async (payload) => {

        const { uid, shiftId, notes } = payload;
        if (!uid) return;

        await db.collection("users").doc(uid).set({ notes }, { merge: true });

        if (shiftId) {
            await db.collection("shiftHistory").doc(shiftId).set({
                notes,
                metrics: { notesWritten: notes.trim().length > 0 }
            }, { merge: true });
        }
    });

    // NOTE: ADD_LOAD used to be a queued handler here. Removed —
    // workspace.js's saveLoad() now writes straight to Firestore
    // (see saveLoadDirect() there) instead of going through the queue,
    // because queued writes only drain strictly in order and stop
    // dead on the first failure, which was silently blocking new
    // employees' loads from ever reaching shiftHistory (and therefore
    // never showing up in Load History, Admin stats, or the
    // per-user drilldown). EDIT_LOAD and DELETE_LOAD are untouched —
    // this was scoped to the specific symptom reported.

    Queue.registerHandler("EDIT_LOAD", async (payload) => {

        const { uid, loadId, changes, shiftId } = payload;
        if (!uid || !loadId) return;

        const userRef = db.collection("users").doc(uid);
        const doc = await userRef.get();
        const data = doc.data() || {};
        const loads = Array.isArray(data.bookedLoads) ? data.bookedLoads : [];

        const updated = loads.map(l => l.id === loadId ? { ...l, ...changes } : l);
        await userRef.set({ bookedLoads: updated }, { merge: true });

        if (shiftId) {

            const shiftRef = db.collection("shiftHistory").doc(shiftId);
            const shiftDoc = await shiftRef.get();
            const shiftData = shiftDoc.data() || {};
            const loadsLog = Array.isArray(shiftData.loadsLog) ? shiftData.loadsLog : [];

            const updatedLog = loadsLog.map(l => l.id === loadId ? { ...l, ...changes } : l);
            await shiftRef.set({ loadsLog: updatedLog }, { merge: true });
        }

        if (typeof logAudit === "function") {
            await logAudit(uid, "LOAD_EDITED", `Load ${loadId} updated`);
        }
    });

    // ===========================================
    // EDIT_HISTORICAL_LOAD (Load History feature)
    // ===========================================
    //
    // Deliberately separate from EDIT_LOAD above so that flow (which
    // always assumes editor === owner, uid = RelayDesk.currentUser)
    // is never touched. This handler edits a load that may belong to
    // ANY employee, found by id inside a specific shift's permanent
    // shiftHistory.loadsLog, and mirrors the change into that owner's
    // live bookedLoads only if the load is still active there. Every
    // call also writes a structured audit entry and, when the editor
    // isn't the original owner, a dismissible notification for them.

    Queue.registerHandler("EDIT_HISTORICAL_LOAD", async (payload) => {

        const { editorUid, ownerUid, shiftId, loadId, vrid, changes, before, after, reason } = payload;
        if (!editorUid || !shiftId || !loadId || !changes) return;

        // 1. permanent record: shiftHistory/{shiftId}.loadsLog
        const shiftRef = db.collection("shiftHistory").doc(shiftId);
        const shiftDoc = await shiftRef.get();
        const shiftData = shiftDoc.data() || {};
        const loadsLog = Array.isArray(shiftData.loadsLog) ? shiftData.loadsLog : [];

        const updatedLog = loadsLog.map(l =>
            l.id === loadId ? { ...l, ...changes } : l
        );

        await shiftRef.set({ loadsLog: updatedLog }, { merge: true });

        // 2. mirror into the owner's live bookedLoads, only if the
        // load is still sitting there (their shift may have already
        // ended and been archived, in which case there's nothing live
        // left to mirror into — the shiftHistory write above already
        // covers that case)
        if (ownerUid) {

            const ownerRef = db.collection("users").doc(ownerUid);
            const ownerDoc = await ownerRef.get();
            const ownerData = ownerDoc.data() || {};
            const liveLoads = Array.isArray(ownerData.bookedLoads) ? ownerData.bookedLoads : [];

            if (liveLoads.some(l => l.id === loadId)) {
                const updatedLive = liveLoads.map(l =>
                    l.id === loadId ? { ...l, ...changes } : l
                );
                await ownerRef.set({ bookedLoads: updatedLive }, { merge: true });
            }
        }

        // 3. structured audit entry (uses audit.js's before/after diff
        // support — additive, doesn't change any other logAudit call)
        if (typeof logAudit === "function") {
            await logAudit(
                editorUid,
                "LOAD_HISTORY_EDITED",
                `Load ${vrid || loadId} updated`,
                { before, after, reason: reason || undefined }
            );
        }

        // 4. notify the original booker, unless they edited their own
        // load themselves
        //
        // `acknowledged` drives the persistent notification card (always
        // visible whenever the owner is logged in, until they dismiss it).
        // `toastShown` is separate and drives the attention-grabbing toast
        // pop-up + sound: false until it has actually been delivered to the
        // owner (either immediately, if they're On Duty right now, or later
        // the next time they switch to On Duty — see loadhistory.js's
        // deliverPendingLoadNotifications(), called from status.js).
        if (ownerUid && ownerUid !== editorUid) {
            await db.collection("loadChangeNotifications").add({
                ownerUid,
                editorUid,
                loadId,
                vrid: vrid || loadId,
                shiftId,
                before,
                after,
                reason: reason || null,
                time: Date.now(),
                acknowledged: false,
                toastShown: false
            });
        }
    });

    // ===========================================
    // DELETE_HISTORICAL_LOAD (Load History feature — admin only)
    // ===========================================
    //
    // Mirrors EDIT_HISTORICAL_LOAD's shape (editor may not be the
    // owner, found by id inside a specific shift's permanent
    // shiftHistory.loadsLog) but performs the same soft-delete
    // DELETE_LOAD already does elsewhere (active:false, never a hard
    // delete — the row stays for audit purposes, it's just excluded
    // from Load History search). Also releases the VRID reservation
    // so that ID becomes bookable again, which is the whole point:
    // clearing out a mistaken/duplicate reservation quickly.
    Queue.registerHandler("DELETE_HISTORICAL_LOAD", async (payload) => {

        const { editorUid, ownerUid, shiftId, loadId, vrid } = payload;
        if (!editorUid || !shiftId || !loadId) return;

        // 1. permanent record: shiftHistory/{shiftId}.loadsLog
        const shiftRef = db.collection("shiftHistory").doc(shiftId);
        const shiftDoc = await shiftRef.get();
        const shiftData = shiftDoc.data() || {};
        const loadsLog = Array.isArray(shiftData.loadsLog) ? shiftData.loadsLog : [];

        const target = loadsLog.find(l => l.id === loadId);

        // idempotent: only write (and decrement the counter) if the
        // load was actually still active
        if (target && target.active !== false) {

            const current = shiftData.metrics?.bookedLoads ?? 0;
            const updatedLog = loadsLog.map(l =>
                l.id === loadId ? { ...l, active: false, deletedAt: Date.now(), deletedBy: editorUid } : l
            );

            await shiftRef.set({
                metrics: { bookedLoads: Math.max(current - 1, 0) },
                loadsLog: updatedLog
            }, { merge: true });
        }

        // 2. mirror into the owner's live bookedLoads, only if the
        // load is still sitting there (their shift may have already
        // ended and been archived, in which case the shiftHistory
        // write above already covers it)
        if (ownerUid) {

            const ownerRef = db.collection("users").doc(ownerUid);
            const ownerDoc = await ownerRef.get();
            const ownerData = ownerDoc.data() || {};
            const liveLoads = Array.isArray(ownerData.bookedLoads) ? ownerData.bookedLoads : [];

            if (liveLoads.some(l => l.id === loadId)) {
                const remaining = liveLoads.filter(l => l.id !== loadId);
                await ownerRef.set({ bookedLoads: remaining }, { merge: true });
            }
        }

        // 3. free up the VRID so it can be reserved again — this is
        // the actual goal (clearing out a stuck/mistaken reservation)
        if (vrid && window.releaseVrid) {
            await window.releaseVrid(vrid);
        }

        // 4. structured audit entry
        if (typeof logAudit === "function") {
            await logAudit(
                editorUid,
                "LOAD_HISTORY_DELETED",
                `Load ${vrid || loadId} deleted from Load History`
            );
        }

        // 5. notify the original booker, unless they deleted their
        // own load themselves
        if (ownerUid && ownerUid !== editorUid) {
            await db.collection("loadChangeNotifications").add({
                ownerUid,
                editorUid,
                loadId,
                vrid: vrid || loadId,
                shiftId,
                before: { status: target?.status || "Booked" },
                after: { status: "Deleted" },
                reason: "Load deleted by admin",
                time: Date.now(),
                acknowledged: false,
                toastShown: false
            });
        }
    });

    Queue.registerHandler("DELETE_LOAD", async (payload) => {

        const { uid, loadId, shiftId } = payload;
        if (!uid || !loadId) return;

        const userRef = db.collection("users").doc(uid);
        const doc = await userRef.get();
        const data = doc.data() || {};
        const loads = Array.isArray(data.bookedLoads) ? data.bookedLoads : [];

        const remaining = loads.filter(l => l.id !== loadId);

        // idempotent: only write (and decrement the counter) if the
        // load was actually still present
        if (remaining.length !== loads.length) {
            await userRef.set({ bookedLoads: remaining }, { merge: true });
        }

        if (shiftId) {

            const shiftRef = db.collection("shiftHistory").doc(shiftId);
            const shiftDoc = await shiftRef.get();
            const shiftData = shiftDoc.data() || {};
            const loadsLog = Array.isArray(shiftData.loadsLog) ? shiftData.loadsLog : [];

            const target = loadsLog.find(l => l.id === loadId);

            if (target && target.active !== false) {

                const current = shiftData.metrics?.bookedLoads ?? 0;
                const updatedLog = loadsLog.map(l =>
                    l.id === loadId ? { ...l, active: false, deletedAt: Date.now() } : l
                );

                await shiftRef.set({
                    metrics: { bookedLoads: Math.max(current - 1, 0) },
                    loadsLog: updatedLog
                }, { merge: true });

                if (typeof logAudit === "function") {
                    await logAudit(uid, "LOAD_DELETED", `Load ${target.vrid || loadId} deleted`);
                }
            }
            // Refresh Load History if it's currently open.
            if (window.refreshLoadHistoryLive) {
                window.refreshLoadHistoryLive();
            }
        }
    });

    Queue.registerHandler("CHAT_MESSAGE", async (payload) => {

        const { chatId, messageId, message, chatMeta } = payload;
        if (!chatId || !messageId) return;

        // .set() on a pre-generated id is idempotent — a retry after a
        // success that failed to *report back* just rewrites the same doc
        await db.collection("chats").doc(chatId)
            .collection("messages").doc(messageId)
            .set(message, { merge: true });

        if (chatMeta) {
            await db.collection("chats").doc(chatId).set(chatMeta, { merge: true });
        }
    });

    // Only the sender is ever allowed to call this (enforced in
    // chat.js's UI — no delete button is even rendered on messages
    // that aren't yours). .delete() on an id that's already gone is a
    // no-op, not an error, so this is safe to retry.
    Queue.registerHandler("DELETE_CHAT_MESSAGE", async (payload) => {

        const { chatId, messageId, imageUrl } = payload;
        if (!chatId || !messageId) return;

        const messagesRef = db.collection("chats").doc(chatId).collection("messages");
        await messagesRef.doc(messageId).delete();

        // Image messages (chat.js image attachments feature) also own a
        // file in Firebase Storage — clean it up too, or it's orphaned
        // forever. Best-effort: a Storage failure (e.g. already deleted
        // by a previous retry) shouldn't block/duplicate the Firestore
        // delete above, which already succeeded by this point.
        if (imageUrl && window.storage) {
            try {
                await window.storage.refFromURL(imageUrl).delete();
            } catch (err) {
                console.warn("Chat image Storage cleanup failed (non-fatal):", err);
            }
        }

        // If the message we just deleted was the one the chat list
        // preview points to (chatMeta.lastMessageId), that pointer is
        // now a ghost — recompute it from whatever's actually left so
        // the preview/last-message don't show deleted content.
        const chatRef = db.collection("chats").doc(chatId);
        const chatDoc = await chatRef.get();
        const chatData = chatDoc.data() || {};

        if (chatData.lastMessageId !== messageId) return;

        const latestSnap = await messagesRef.orderBy("time", "desc").limit(1).get();

        if (latestSnap.empty) {
            await chatRef.set({
                lastMessage: "",
                lastFrom: null,
                lastMessageId: null
                // lastTime intentionally left alone — used only for
                // chat-list sort order, not worth resetting
            }, { merge: true });
            return;
        }

        const latest = latestSnap.docs[0];
        const m = latest.data();

        await chatRef.set({
            lastMessage: m.text,
            lastTime: m.time,
            lastFrom: m.from,
            lastMessageId: latest.id
        }, { merge: true });
    });

    // Only the sender is ever allowed to call this (enforced in
    // chat.js's UI — same as delete, no edit button rendered on
    // messages that aren't yours). Stamps `edited: true` + `editedAt`
    // so the bubble can show an "edited" tag without losing the
    // original send `time` (used for ordering/receipts elsewhere).
    // If the edited message is the chat's current lastMessage preview,
    // that preview text is refreshed too so the chat list doesn't show
    // stale content.
    Queue.registerHandler("EDIT_CHAT_MESSAGE", async (payload) => {

        const { chatId, messageId, newText } = payload;
        if (!chatId || !messageId || !newText) return;

        const messagesRef = db.collection("chats").doc(chatId).collection("messages");

        await messagesRef.doc(messageId).set({
            text: newText,
            edited: true,
            editedAt: Date.now()
        }, { merge: true });

        const chatRef = db.collection("chats").doc(chatId);
        const chatDoc = await chatRef.get();
        const chatData = chatDoc.data() || {};

        if (chatData.lastMessageId === messageId) {
            await chatRef.set({ lastMessage: newText }, { merge: true });
        }
    });

    // Permanent, for-everyone deletion of an entire chat (group
    // creator/Admin only — enforced in chat.js's UI). Wipes the
    // messages subcollection in batches (Firestore caps a batch at
    // 500 ops; 450 leaves headroom) then deletes the chat doc itself.
    // Retry-safe: an empty messages query and a delete() on an
    // already-gone doc are both no-ops.
    Queue.registerHandler("DELETE_CHAT", async (payload) => {

        const { chatId } = payload;
        if (!chatId) return;

        const messagesRef = db.collection("chats").doc(chatId).collection("messages");
        const snap = await messagesRef.get();

        const docs = snap.docs;
        const BATCH_SIZE = 450;

        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        await db.collection("chats").doc(chatId).delete();
    });

    // Generic escape hatch for write types this file doesn't know the
    // exact shape of yet (e.g. shift status Away/Back toggles,
    // end-of-shift report submission living in other modules).
    // Callers: RelayDesk.queue.enqueue("FIRESTORE_MERGE",
    //   { collection: "users", docId: uid, data: {...} })
    Queue.registerHandler("FIRESTORE_MERGE", async (payload) => {

        const { collection, docId, data } = payload;
        if (!collection || !docId || !data) return;

        await db.collection(collection).doc(docId).set(data, { merge: true });
    });

    // ===========================================
    // SYNC ENGINE
    // ===========================================

    function kickSync() {
        if (Queue.isSyncing) return;
        processQueue();
    }

    async function processQueue() {

        if (Queue.isSyncing) return;
        if (!Queue.items.length) return;

        if (!navigator.onLine) {
            markOffline();
            scheduleRetry();
            return;
        }

        Queue.isSyncing = true;
        updateStatusUI();

        while (Queue.items.length) {

            const item = Queue.items[0];
            const handler = Queue.handlers[item.type];

            if (!handler) {
                console.warn(`⚠️ Queue: no handler for "${item.type}", dropping item`, item);
                Queue.items.shift();
                persist();
                continue;
            }

            try {

                await handler(item.payload);

                // success — clear offline flag/backoff and drop the item
                Queue.assumedOffline = false;
                Queue.retryDelay = BASE_RETRY_MS;

                Queue.items.shift();
                persist();
                updateStatusUI();

            } catch (err) {

                console.warn("⚠️ Queue: write failed, will retry", item.type, err);
                item.attempts = (item.attempts || 0) + 1;

                markOffline();
                persist();
                break; // stop draining — preserve order, retry from here
            }
        }

        Queue.isSyncing = false;
        updateStatusUI();

        if (Queue.items.length) scheduleRetry();
    }

    function markOffline() {
        Queue.assumedOffline = true;
        updateStatusUI();
    }

    function scheduleRetry() {

        clearTimeout(Queue.retryTimer);

        Queue.retryTimer = setTimeout(() => {
            Queue.retryDelay = Math.min(Queue.retryDelay * 1.5, MAX_RETRY_MS);
            processQueue();
        }, Queue.retryDelay);
    }

    window.addEventListener("online", () => {
        Queue.assumedOffline = false;
        Queue.retryDelay = BASE_RETRY_MS;
        updateStatusUI();
        kickSync();
    });

    window.addEventListener("offline", () => {
        markOffline();
    });

    // ===========================================
    // STATUS INDICATOR UI
    // 🟢 Synced   🟡 Syncing...   🔴 Offline (X pending)
    // ===========================================

    function ensureIndicator() {

        if (Queue.UI.el) return Queue.UI.el;

        // Prefer an existing static placeholder already in the page (e.g. the
        // top bar slot in index.html) over creating a new floating badge —
        // same pattern used for the report formatter panel. Falls back to a
        // fixed-position badge for any screen that doesn't have that slot.
        const existing = document.getElementById("queueStatusIndicator");
        if (existing) {
            Queue.UI.el = existing;
            return existing;
        }

        const el = document.createElement("div");
        el.id = "queueStatusIndicator";
        el.className = "queueStatusIndicator";
        el.style.cssText = [
            "position:fixed", "bottom:14px", "right:14px",
            "padding:6px 12px", "border-radius:999px",
            "font-size:12px", "font-family:sans-serif",
            "background:rgba(0,0,0,0.75)", "color:#fff",
            "z-index:9999", "pointer-events:none",
            "transition:opacity .2s ease"
        ].join(";");

        document.body.appendChild(el);
        Queue.UI.el = el;
        return el;
    }

    function updateStatusUI() {

        if (typeof document === "undefined" || !document.body) return;

        const el = ensureIndicator();
        const pending = Queue.pendingCount();

        el.classList.remove("connected", "reconnecting", "disconnected");

        if (Queue.assumedOffline || !navigator.onLine) {
            el.textContent = `🔴 Offline${pending ? ` (${pending} pending)` : ""}`;
            el.classList.add("disconnected");
        } else if (Queue.isSyncing || pending > 0) {
            el.textContent = `🟡 Syncing...${pending ? ` (${pending})` : ""}`;
            el.classList.add("reconnecting");
        } else {
            el.textContent = "🟢 Synced";
            el.classList.add("connected");
        }
    }

    // ===========================================
    // BOOT — resume any queue left over from a previous session
    // ===========================================

    restore();

    function bootUI() {
        updateStatusUI();
        if (Queue.items.length) kickSync();
    }

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", bootUI);
    } else {
        // DOMContentLoaded already fired before this script ran —
        // boot immediately instead of waiting for an event that
        // will never come.
        bootUI();
    }

    RelayDesk.queue = Queue;

    console.log(`📦 Activity queue ready (${Queue.items.length} item(s) resumed)`);

})();
