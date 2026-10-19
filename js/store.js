// Local-first collection storage. Cloud sync is an optional side effect.
export const COLLECTION_NAMES = ["entries", "braindump", "milestones", "ideas"];
const key = name => {
    if (!COLLECTION_NAMES.includes(name)) throw new Error("Unknown Chronicle collection: " + name);
    return "chronicle." + name;
};
const recoveryKey = name => "chronicle.recovery." + name;
function parseRecords(raw) {
    if (raw == null) return null;
    try { const value = JSON.parse(raw); return Array.isArray(value) ? value : null; }
    catch { return null; }
}
function emit(type, detail) {
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") window.dispatchEvent(new CustomEvent(type, { detail }));
}
function enqueueSync(name) {
    try {
        const settings = JSON.parse(localStorage.getItem("chronicle.settings") || "null");
        if (settings?.sync?.enabled) import("./syncqueue.js").then(m => m.enqueueSync(name)).catch(err => console.warn("Optional cloud sync failed:", err));
    } catch { /* Local storage must never depend on the network. */ }
}
function preserveRecovery(name, raw) {
    if (parseRecords(raw) === null) return;
    try { localStorage.setItem(recoveryKey(name), raw); }
    catch (err) {
        if (parseRecords(localStorage.getItem(recoveryKey(name))) === null) throw new Error("Device storage is full. A recovery copy could not be preserved, so this change was not saved.");
        console.warn("Could not refresh recovery copy for " + name + ":", err);
    }
}
function readForBackup(name) {
    const raw = localStorage.getItem(key(name));
    if (raw == null) return [];
    const records = parseRecords(raw);
    if (records !== null) return records;
    const recovery = parseRecords(localStorage.getItem(recoveryKey(name)));
    if (recovery !== null) return recovery;
    throw new Error("The " + name + " collection is unreadable and has no valid recovery copy. Data was preserved; export stopped to avoid an incomplete backup.");
}
function readCollection(name) {
    const storageKey = key(name);
    let raw;
    try { raw = localStorage.getItem(storageKey); }
    catch (err) {
        emit("chronicle:storage-error", { collection: name, message: "Local storage could not be accessed. Check device storage." });
        console.warn("Could not read " + name + ":", err);
        return [];
    }
    if (raw == null) return [];
    const records = parseRecords(raw);
    if (records !== null) return records;
    const recoveryRaw = localStorage.getItem(recoveryKey(name));
    const recovery = parseRecords(recoveryRaw);
    if (recovery !== null) {
        try { localStorage.setItem(storageKey, recoveryRaw); } catch (err) { console.warn("Could not repair " + name + " storage:", err); }
        emit("chronicle:storage-recovered", { collection: name, message: "Recovered " + name + " from its last known-good local copy." });
        return recovery;
    }
    emit("chronicle:storage-error", { collection: name, message: "The " + name + " collection is unreadable. Data was preserved; import a valid backup before editing it." });
    console.error("Unreadable Chronicle collection preserved:", name);
    return [];
}
function readForWrite(name) {
    const storageKey = key(name), raw = localStorage.getItem(storageKey);
    if (raw == null) return [];
    const records = parseRecords(raw);
    if (records !== null) return records;
    const recoveryRaw = localStorage.getItem(recoveryKey(name)), recovery = parseRecords(recoveryRaw);
    if (recovery !== null) {
        try { localStorage.setItem(storageKey, recoveryRaw); } catch { /* use recovered records in memory */ }
        return recovery;
    }
    throw new Error("The " + name + " collection is unreadable. No changes were saved and the original data was not overwritten. Import a valid backup to recover it.");
}
function notify(name) {
    emit("chronicle:change", { collection: name });
    enqueueSync(name);
}
function writeCollection(name, records) {
    const storageKey = key(name);
    if (!Array.isArray(records)) throw new TypeError("The " + name + " collection must be an array.");
    const oldRaw = localStorage.getItem(storageKey), oldRecords = parseRecords(oldRaw);
    if (oldRaw !== null && oldRecords === null && parseRecords(localStorage.getItem(recoveryKey(name))) === null) {
        throw new Error("The " + name + " collection is unreadable. Original data was preserved and this change was not saved.");
    }
    if (oldRecords !== null) preserveRecovery(name, oldRaw);
    localStorage.setItem(storageKey, JSON.stringify(records));
    notify(name);
}
export function replaceCollections(collections) {
    if (!collections || typeof collections !== "object" || Array.isArray(collections) ||
        COLLECTION_NAMES.some(name => !Array.isArray(collections[name]))) throw new Error("This backup is incomplete. All four Chronicle collections are required.");
    const serialized = {};
    for (const name of COLLECTION_NAMES) {
        if (collections[name].some(item => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("The " + name + " collection in this backup is invalid.");
        serialized[name] = JSON.stringify(collections[name]);
    }
    const previous = {};
    for (const name of COLLECTION_NAMES) previous[name] = {
        primary: localStorage.getItem(key(name)), recovery: localStorage.getItem(recoveryKey(name))
    };
    try {
        for (const name of COLLECTION_NAMES) if (parseRecords(previous[name].primary) !== null) preserveRecovery(name, previous[name].primary);
        for (const name of COLLECTION_NAMES) localStorage.setItem(key(name), serialized[name]);
    } catch (err) {
        for (const name of COLLECTION_NAMES) {
            try {
                if (previous[name].primary == null) localStorage.removeItem(key(name)); else localStorage.setItem(key(name), previous[name].primary);
                if (previous[name].recovery == null) localStorage.removeItem(recoveryKey(name)); else localStorage.setItem(recoveryKey(name), previous[name].recovery);
            } catch (rollbackErr) { console.error("Could not fully roll back " + name + ":", rollbackErr); }
        }
        throw new Error("Backup could not be applied: " + (err?.message || "local storage write failed"));
    }
    COLLECTION_NAMES.forEach(notify);
    return Object.fromEntries(COLLECTION_NAMES.map(name => [name, collections[name].length]));
}
export function readCollectionsSnapshot() {
    return Object.fromEntries(COLLECTION_NAMES.map(name => [name, readForBackup(name)]));
}
function generateId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9); }
export function openCollection(name) {
    key(name);
    return {
        all() { return readCollection(name); },
        get(id) { return readCollection(name).find(record => record.id === id) || null; },
        create(fields) {
            const records = readForWrite(name), now = new Date().toISOString();
            const record = { id: generateId(), createdAt: now, updatedAt: now, archived: false, ...fields };
            records.push(record); writeCollection(name, records); return record;
        },
        update(id, changes) {
            const records = readForWrite(name), index = records.findIndex(record => record.id === id);
            if (index === -1) return null;
            records[index] = { ...records[index], ...changes, id: records[index].id, updatedAt: new Date().toISOString() };
            writeCollection(name, records); return records[index];
        },
        archive(id) { return this.update(id, { archived: true }); },
        restore(id) { return this.update(id, { archived: false }); },
        hardDelete(id) { writeCollection(name, readForWrite(name).filter(record => record.id !== id)); }
    };
}
