import { replaceCollections } from "./store.js";
// ===========================================
// The Glitchcore Chronicle
// js/syncqueue.js
// MILESTONE 13: Sync queue + manual backup
// ===========================================
// Chronicle-native FIFO write queue, pattern borrowed from queue.js
// (not the file itself — no window.RelayDesk/Firestore-compat ties).
// Persisted to localStorage, retries with backoff, drains on
// reconnect. Only ever runs if settings.sync.enabled is true.

import { writeDoc, readDoc, getCurrentUser } from "./firebase.js";

const QUEUE_KEY = "chronicle.syncQueue";
const EXPORTED_COLLECTIONS = ["entries", "braindump", "milestones", "ideas"];

let queue = loadQueue();
let draining = false;

function loadQueue() {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveQueue() {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
        console.warn("Could not persist sync queue:", err);
    }
}

// Call this from store.js writes when sync is enabled — enqueues a
// full push of that collection (simple + safe over per-record diffs).
export function enqueueSync(collectionName) {
    if (!EXPORTED_COLLECTIONS.includes(collectionName)) return;

    queue = queue.filter(item => item.collectionName !== collectionName);
    queue.push({ collectionName, attempts: 0, queuedAt: new Date().toISOString() });
    saveQueue();
    drainQueue();
}

async function drainQueue() {
    if (draining || !queue.length) return;
    if (!navigator.onLine) return;

    draining = true;
    while (queue.length) {
        const user = getCurrentUser();
        if (!user) {
            console.warn("Sync paused: sign in with Google first — Firestore rules require it.");
            break;
        }

        const { connectFirebase } = await import("./firebase.js");
        const connectResult = await connectFirebase();
        if (!connectResult.ok) {
            console.warn("Sync paused: Firebase connect failed:", connectResult.error);
            break;
        }

        const item = queue[0];
        try {
            const raw = localStorage.getItem(`chronicle.${item.collectionName}`);
            const records = raw ? JSON.parse(raw) : [];
            await writeDoc(`users/${user.uid}/chronicleBackups`, item.collectionName, {
                records,
                syncedAt: new Date().toISOString()
            });
            queue.shift();
            saveQueue();
        } catch (err) {
            item.attempts += 1;
            saveQueue();
            console.warn(`Sync failed for ${item.collectionName} (attempt ${item.attempts}):`, err);
            const backoffMs = Math.min(30000, 1000 * 2 ** item.attempts);
            setTimeout(drainQueue, backoffMs);
            break;
        }
    }
    draining = false;
}

window.addEventListener("online", drainQueue);

// Where manual, versioned backups live — separate from the live
// per-edit auto-sync mirror above (users/{uid}/chronicleBackups),
// which keeps getting silently overwritten on every edit. Every
// "Back Up Now" click writes a brand-new document here instead of
// overwriting the last one, so restoring can actually go back to an
// earlier point in time instead of just re-downloading whatever's
// already sitting in the live mirror (which, by the time you go to
// restore, is usually identical to your current local state).
const SNAPSHOT_COLLECTION = "chronicleSnapshots";

// Manual "Back Up Now" — saves a brand-new dated snapshot of all four
// collections together, so restoring one snapshot always restores a
// single consistent point in time across entries/braindump/
// milestones/ideas rather than mixing versions.
export async function backupNow() {
    const user = getCurrentUser();
    if (!user) {
        return { ok: false, queued: 0, error: "Sign in with Google first — Firestore rules require an authenticated user." };
    }

    const { connectFirebase, writeDoc } = await import("./firebase.js");
    const connectResult = await connectFirebase();
    if (!connectResult.ok) {
        return { ok: false, queued: 0, error: `Couldn't connect to Firebase: ${connectResult.error}` };
    }

    const collections = {};
    const counts = {};
    for (const name of EXPORTED_COLLECTIONS) {
        const raw = localStorage.getItem(`chronicle.${name}`);
        const records = raw ? JSON.parse(raw) : [];
        collections[name] = records;
        counts[name] = records.length;
    }

    // ISO strings sort lexicographically in the same order as
    // chronologically, so this doubles as both the doc ID and the
    // sort key for listSnapshots() below — no extra query index needed.
    const snapshotId = new Date().toISOString();

    try {
        await writeDoc(`users/${user.uid}/${SNAPSHOT_COLLECTION}`, snapshotId, {
            createdAt: snapshotId,
            counts,
            collections
        });
    } catch (err) {
        console.warn("Backup failed:", err);
        return { ok: false, queued: 0, error: err?.message || "Backup failed. Check Firestore rules/console." };
    }

    return { ok: true, queued: EXPORTED_COLLECTIONS.length, snapshotId };
}

// Lists saved snapshots, newest first — deliberately leaves the heavy
// `collections` payload out of what's returned here (counts only) so
// the picker in Settings doesn't have to download every full backup
// just to show a list of dates.
export async function listSnapshots() {
    const user = getCurrentUser();
    if (!user) {
        throw new Error("Sign in with Google first — Firestore rules require an authenticated user.");
    }

    const { connectFirebase, listDocs } = await import("./firebase.js");
    const connectResult = await connectFirebase();
    if (!connectResult.ok) {
        throw new Error(`Couldn't connect to Firebase: ${connectResult.error}`);
    }

    const docs = await listDocs(`users/${user.uid}/${SNAPSHOT_COLLECTION}`);
    return docs
        .map(({ id, data }) => ({ id, createdAt: data.createdAt || id, counts: data.counts || {} }))
        .sort((a, b) => b.id.localeCompare(a.id));
}

// Restores one specific snapshot by ID (from listSnapshots above),
// overwriting local storage for all four collections with that
// snapshot's data. Caller should confirm with the user first —
// destructive, like Settings' existing import.
export async function restoreSnapshot(snapshotId) {
    const user = getCurrentUser();
    if (!user) {
        throw new Error("Sign in with Google first — Firestore rules require an authenticated user.");
    }

    const { connectFirebase, readDoc } = await import("./firebase.js");
    const connectResult = await connectFirebase();
    if (!connectResult.ok) {
        throw new Error(`Couldn't connect to Firebase: ${connectResult.error}`);
    }

    const doc = await readDoc(`users/${user.uid}/${SNAPSHOT_COLLECTION}`, snapshotId);
    if (!doc?.collections) {
        throw new Error("That backup couldn't be found — it may have been deleted.");
    }

    const collections = {};
    for (const name of EXPORTED_COLLECTIONS) {
        const records = doc.collections[name];
        if (!Array.isArray(records)) throw new Error("That backup is incomplete: the " + name + " collection is missing or invalid.");
        collections[name] = records;
    }
    return replaceCollections(collections);
}

export function getQueueStatus() {
    return { pending: queue.length, items: queue.map(i => i.collectionName) };
}
