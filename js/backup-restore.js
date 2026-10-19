// TGC Phase 7: safer local and cloud backup restore flows.
// Existing collections are never mutated until a complete preview and a durable safety copy exist.
import { COLLECTION_NAMES, readCollectionsSnapshot, replaceCollections, getStorageProfile } from "./store.js";

const BACKUP_FORMAT = "the-glitchcore-chronicle-backup";
const SAFETY_FORMAT = "the-glitchcore-chronicle-pre-restore-safety-backup";
const JOURNAL_PREFIX = "chronicle.restorePending.";
const SAFETY_PREFIX = "chronicle.restoreSafety.";
const LABELS = { entries: "entries", braindump: "brain dump", milestones: "milestones", ideas: "ideas" };
let panel;
let pending = null;

function profileKey(prefix) { return prefix + getStorageProfile(); }
function newId() { return globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12)); }
function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
    return JSON.stringify(value);
}
function validateBackup(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This file is not a valid TGC backup object.");
    if (value.format !== "the-glitchcore-chronicle-backup" && value.format !== SAFETY_FORMAT && value.format !== "the-glitchcore-chronicle-migration-safety-backup") {
        throw new Error("This backup format is not recognized. Your current chronicle was not changed.");
    }
    if (value.schemaVersion !== 1) throw new Error("This backup version is not supported by this app version.");
    const source = value.collections;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("The backup is missing its collections object.");
    const collections = {};
    for (const name of COLLECTION_NAMES) {
        if (!Array.isArray(source[name])) throw new Error("The backup is missing the " + LABELS[name] + " collection.");
        if (source[name].some(item => !item || typeof item !== "object" || Array.isArray(item))) {
            throw new Error("The " + LABELS[name] + " collection contains an invalid record. Nothing was changed.");
        }
        collections[name] = source[name].map(item => ({ ...item }));
    }
    return { collections, exportedAt: value.exportedAt || value.createdAt || null, format: value.format };
}
function inspect(current, incoming) {
    const result = {};
    for (const name of COLLECTION_NAMES) {
        const existing = current[name], source = incoming[name];
        const byId = new Map(existing.filter(r => r.id != null).map(r => [String(r.id), r]));
        let identical = 0, conflicts = 0, noId = 0, additions = 0;
        for (const record of source) {
            if (record.id == null) { noId++; additions++; continue; }
            const old = byId.get(String(record.id));
            if (!old) additions++;
            else if (stable(old) === stable(record)) identical++;
            else { conflicts++; additions++; }
        }
        result[name] = { current: existing.length, backup: source.length, identical, conflicts, noId, additions };
    }
    return result;
}
function mergeCollections(current, incoming) {
    const merged = {}, stats = {};
    for (const name of COLLECTION_NAMES) {
        const target = current[name].map(record => ({ ...record }));
        const byId = new Map(target.filter(r => r.id != null).map(r => [String(r.id), r]));
        let added = 0, identical = 0, conflicts = 0, assignedIds = 0;
        for (const source of incoming[name]) {
            const record = { ...source };
            if (record.id == null) {
                record.id = newId(); assignedIds++;
                while (byId.has(String(record.id))) record.id = newId();
                target.push(record); byId.set(String(record.id), record); added++; continue;
            }
            const existing = byId.get(String(record.id));
            if (!existing) { target.push(record); byId.set(String(record.id), record); added++; continue; }
            if (stable(existing) === stable(record)) { identical++; continue; }
            const oldId = String(record.id);
            record.id = newId();
            while (byId.has(String(record.id))) record.id = newId();
            record.restoreConflictOf = oldId;
            target.push(record); byId.set(String(record.id), record); added++; conflicts++;
        }
        merged[name] = target;
        stats[name] = { added, identical, conflicts, assignedIds, total: target.length };
    }
    return { collections: merged, stats };
}
function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; link.style.display = "none";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function saveSafetyCopy(current) {
    const createdAt = new Date().toISOString();
    const key = SAFETY_PREFIX + getStorageProfile() + "." + createdAt.replace(/[^0-9]/g, "").slice(0, 14) + "." + newId().slice(0, 8);
    const payload = { format: SAFETY_FORMAT, schemaVersion: 1, createdAt, profile: getStorageProfile(), collections: current };
    try {
        localStorage.setItem(key, JSON.stringify(payload));
        localStorage.setItem(profileKey(JOURNAL_PREFIX), JSON.stringify({ key, createdAt, profile: getStorageProfile(), collections: current }));
    } catch {
        try { localStorage.removeItem(key); } catch {}
        throw new Error("TGC couldn't save a complete pre-restore safety copy (device storage may be full). No records were changed. Export your chronicle and free storage before retrying.");
    }
    try { downloadJson(payload, "tgc-pre-restore-safety-" + createdAt.slice(0, 10) + ".json"); }
    catch (error) { console.warn("Safety copy download could not be started; the local copy is retained.", error); }
    return key;
}
function setStatus(message, tone = "normal") {
    const status = document.getElementById("settingsDataStatus");
    if (status) { status.textContent = message; status.dataset.tone = tone; }
}
function ensurePanel() {
    if (panel?.isConnected) return panel;
    const mount = document.getElementById("settingsPage");
    if (!mount) return null;
    panel = document.createElement("section");
    panel.id = "settingsRestorePreview";
    panel.className = "settingsSection";
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    const dataSection = mount.querySelector("#settingsStorageSection");
    mount.insertBefore(panel, dataSection || mount.firstChild);
    return panel;
}
function clearPreview() { pending = null; const el = ensurePanel(); if (el) { el.hidden = true; el.innerHTML = ""; } }
function renderPreview(sourceLabel, backup, current, onCancel) {
    const el = ensurePanel(); if (!el) throw new Error("The Settings screen is not ready.");
    pending = { sourceLabel, backup, current, onCancel };
    const stats = inspect(current, backup.collections);
    const lines = COLLECTION_NAMES.map(name => {
        const s = stats[name];
        return "<tr><th scope=\"row\">" + LABELS[name] + "</th><td>" + s.current + "</td><td>" + s.backup + "</td><td>" + s.identical + "</td><td>" + s.conflicts + "</td></tr>";
    }).join("");
    el.innerHTML = `
      <h2 class="settingsSectionTitle">Restore preview</h2>
      <p class="settingsRowHint">Source: [SOURCE_LABEL]. No data has changed yet. Choose Merge to preserve current records, or Replace to restore the backup after creating a safety copy.</p>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th scope="col">Collection</th><th scope="col">Current</th><th scope="col">Backup</th><th scope="col">Identical</th><th scope="col">ID conflicts</th></tr></thead><tbody>${lines}</tbody></table></div>
      <p class="settingsRowHint">Merge keeps existing records, skips identical duplicates, and gives conflicting backup records new IDs. Replace swaps all four collections but first saves and downloads a pre-restore safety copy.</p>
      <div class="settingsRowControl" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button type="button" class="settingsBtn" id="settingsRestoreMergeBtn">Merge backup</button>
        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsRestoreReplaceBtn">Replace current data</button>
        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsRestoreCancelBtn">Cancel</button>
      </div>
      <p class="settingsStatusText" id="settingsRestorePreviewStatus"></p>`;
    el.hidden = false;
    const sourceDescription = el.querySelector(".settingsRowHint");
    if (sourceDescription) sourceDescription.textContent = "Source: " + sourceLabel + ". No data has changed yet. Choose Merge to preserve current records, or Replace to restore the backup after creating a safety copy.";
    el.querySelector("#settingsRestoreCancelBtn").addEventListener("click", () => { const cb = pending?.onCancel; clearPreview(); cb?.(); });
    el.querySelector("#settingsRestoreMergeBtn").addEventListener("click", () => applyRestore("merge"));
    el.querySelector("#settingsRestoreReplaceBtn").addEventListener("click", () => applyRestore("replace"));
    el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}
function applyRestore(mode) {
    if (!pending) return;
    const operation = pending;
    if (mode === "replace" && !window.confirm("Replace all four current collections with this backup? TGC will save and download a safety copy first. Continue?")) return;
    if (mode === "merge" && !window.confirm("Merge this backup into the current chronicle? Existing records will be kept; identical records are skipped and ID conflicts are preserved as separate records.")) return;
    const status = document.getElementById("settingsRestorePreviewStatus");
    const buttons = panel?.querySelectorAll("button");
    buttons?.forEach(button => { button.disabled = true; });
    try {
        const current = readCollectionsSnapshot();
        saveSafetyCopy(current);
        let counts;
        if (mode === "merge") {
            const result = mergeCollections(current, operation.backup.collections);
            counts = replaceCollections(result.collections);
            const added = Object.values(result.stats).reduce((sum, item) => sum + item.added, 0);
            const conflicts = Object.values(result.stats).reduce((sum, item) => sum + item.conflicts, 0);
            setStatus("Backup merged safely: " + added + " records added, " + conflicts + " ID conflicts preserved. A pre-restore safety copy was saved.");
        } else {
            counts = replaceCollections(operation.backup.collections);
            setStatus("Backup restored. A pre-restore safety copy was saved locally and a download was started.");
        }
        localStorage.removeItem(profileKey(JOURNAL_PREFIX));
        clearPreview();
        const summary = Object.entries(counts).map(([name, count]) => count + " " + LABELS[name]).join(", ");
        setStatus((mode === "merge" ? "Merge complete. " : "Restore complete. ") + summary + ". Reloading…");
        setTimeout(() => window.location.reload(), 700);
    } catch (error) {
        if (status) status.textContent = "Restore stopped: " + (error?.message || "storage error") + ". If interrupted, use the recovery action below.";
        buttons?.forEach(button => { button.disabled = false; });
    }
}
async function previewFile(file) {
    try {
        const parsed = JSON.parse(await file.text());
        const backup = validateBackup(parsed);
        const current = readCollectionsSnapshot();
        renderPreview("local file " + file.name.replace(/[<>]/g, ""), backup, current, null);
        setStatus("Backup validated. Review the preview before choosing an action.");
    } catch (error) { setStatus("Import preview failed: " + (error?.message || "file could not be read")); }
}
async function previewCloudSnapshot(snapshotId) {
    try {
        if (getStorageProfile() !== "account") throw new Error("Cloud restore is unavailable in guest mode.");
        if (!navigator.onLine) throw new Error("Connect to the internet before previewing a cloud backup.");
        const { getCurrentUser, connectFirebase, readDoc } = await import("./firebase.js");
        const user = getCurrentUser();
        if (!user) throw new Error("Sign in to the account that owns this backup first.");
        const connected = await connectFirebase();
        if (!connected.ok) throw new Error(connected.error || "Could not connect to cloud backup.");
        const doc = await readDoc("users/" + user.uid + "/chronicleSnapshots", snapshotId);
        if (!doc) throw new Error("That cloud backup could not be found.");
        const backup = validateBackup({ format: "the-glitchcore-chronicle-backup", schemaVersion: 1, exportedAt: doc.createdAt || snapshotId, collections: doc.collections });
        const current = readCollectionsSnapshot();
        renderPreview("cloud snapshot " + new Date(doc.createdAt || snapshotId).toLocaleString(), backup, current, null);
        setStatus("Cloud backup validated. Review the preview before restoring.");
    } catch (error) { setStatus("Cloud restore preview failed: " + (error?.message || "unknown error")); }
}
function showInterruptedRestore() {
    let journal;
    try { journal = JSON.parse(localStorage.getItem(profileKey(JOURNAL_PREFIX)) || "null"); } catch {}
    if (!journal?.collections) return;
    const el = ensurePanel(); if (!el) return;
    el.hidden = false;
    const note = document.createElement("p");
    note.className = "settingsRowHint";
    note.textContent = "TGC found an unfinished restore operation from " + (journal.createdAt || "an earlier session") + ". If the app closed mid-restore, recover the pre-restore data before continuing.";
    const button = document.createElement("button");
    button.type = "button"; button.className = "settingsBtn settingsBtnGhost"; button.textContent = "Recover pre-restore data";
    button.addEventListener("click", () => {
        if (!window.confirm("Restore the saved pre-restore collections? This will return the chronicle to the state saved before the interrupted operation.")) return;
        try {
            const valid = validateBackup({ format: SAFETY_FORMAT, schemaVersion: 1, collections: journal.collections });
            replaceCollections(valid.collections);
            localStorage.removeItem(profileKey(JOURNAL_PREFIX));
            setStatus("Pre-restore data recovered. Reloading…");
            setTimeout(() => window.location.reload(), 700);
        } catch (error) { setStatus("Recovery failed: " + (error?.message || "unknown error")); }
    });
    el.prepend(note, button);
}
export function initBackupRestoreSafety() {
    const mount = document.getElementById("settingsPage");
    if (!mount || mount.dataset.restoreSafetyBound === "true") return;
    mount.dataset.restoreSafetyBound = "true";
    ensurePanel();
    mount.addEventListener("click", event => {
        const importButton = event.target.closest?.("#settingsImportBtn");
        if (importButton) {
            event.preventDefault(); event.stopImmediatePropagation();
            document.getElementById("settingsImportInput")?.click();
            return;
        }
        const cloudRestore = event.target.closest?.(".settingsSnapshotRestoreBtn");
        if (cloudRestore) {
            event.preventDefault(); event.stopImmediatePropagation();
            const id = cloudRestore.closest(".settingsSnapshotRow")?.dataset.snapshotId;
            if (id) previewCloudSnapshot(id);
        }
    }, true);
    mount.addEventListener("change", event => {
        if (event.target?.id !== "settingsImportInput") return;
        event.stopImmediatePropagation();
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) previewFile(file);
    }, true);
    showInterruptedRestore();
}
