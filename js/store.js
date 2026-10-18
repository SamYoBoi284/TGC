// ===========================================
// The Glitchcore Chronicle
// js/store.js
// MILESTONE 2: Journal Entries
// ===========================================
//
// A tiny generic localStorage-backed collection store. Not specific
// to entries — Brain Dump, Milestones, and Ideas (later milestones)
// will each open their own collection through this same module
// instead of re-inventing CRUD + persistence.
//
// Every record automatically gets: id, createdAt, updatedAt, archived.
// Nothing is ever hard-deleted through here — see softDelete().

function readCollection(name) {
    try {
        const raw = localStorage.getItem(`chronicle.${name}`);
        return raw ? JSON.parse(raw) : [];
    } catch {
        // Corrupt JSON should never crash the app — treat as empty.
        return [];
    }
}

function maybeEnqueueSync(name) {
    try {
        const raw = localStorage.getItem("chronicle.settings");
        const settings = raw ? JSON.parse(raw) : null;
        if (settings?.sync?.enabled) {
            import("./syncqueue.js").then(m => m.enqueueSync(name));
        }
    } catch { /* sync is opt-in, never block a local write over this */ }
}

function writeCollection(name, records) {
    localStorage.setItem(`chronicle.${name}`, JSON.stringify(records));

    // MILESTONE 10: Reactive Home Widgets
    // Additive-only signal — doesn't touch any return values or call
    // signatures above. Anything that wants to react to a collection
    // changing (Home widgets, On This Day) just listens for this
    // instead of polling.
    window.dispatchEvent(new CustomEvent("chronicle:change", { detail: { collection: name } }));

    // MILESTONE 13: Sync queue — additive, no-ops entirely if cloud
    // backup is off.
    maybeEnqueueSync(name);
}

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function openCollection(name) {
    return {
        all() {
            return readCollection(name);
        },

        get(id) {
            return readCollection(name).find(r => r.id === id) || null;
        },

        create(fields) {
            const records = readCollection(name);
            const now = new Date().toISOString();
            const record = {
                id: generateId(),
                createdAt: now,
                updatedAt: now,
                archived: false,
                ...fields
            };
            records.push(record);
            writeCollection(name, records);
            return record;
        },

        update(id, changes) {
            const records = readCollection(name);
            const index = records.findIndex(r => r.id === id);
            if (index === -1) return null;

            records[index] = {
                ...records[index],
                ...changes,
                id: records[index].id, // never allow id to drift
                updatedAt: new Date().toISOString()
            };
            writeCollection(name, records);
            return records[index];
        },

        // Philosophy: nothing is ever permanently deleted. This just
        // flags a record archived; it still lives in the collection.
        archive(id) {
            return this.update(id, { archived: true });
        },

        restore(id) {
            return this.update(id, { archived: false });
        },

        // Hard delete exists only for internal/dev use, never wired
        // to a UI button. Real "delete" in the UI means archive().
        hardDelete(id) {
            const records = readCollection(name).filter(r => r.id !== id);
            writeCollection(name, records);
        }
    };
}
