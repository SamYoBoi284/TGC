// TGC Phase 6: safe guest-to-account migration.
// Guest data is read-only during migration and is never deleted.
import { COLLECTION_NAMES, replaceCollections, getStorageProfile } from "./store.js";

const LABELS = { entries: "entries", braindump: "brain dump", milestones: "milestones", ideas: "ideas" };
const BACKUP_PREFIX = "chronicle.migrationBackup.";

function parseCollection(raw, label) {
    if (raw == null) return [];
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error("The " + label + " collection is unreadable. No migration was performed."); }
    if (!Array.isArray(value) || value.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
        throw new Error("The " + label + " collection is invalid. No migration was performed.");
    }
    return value;
}

function readProfile(profile) {
    const prefix = profile === "guest" ? "chronicle.guest." : "chronicle.";
    return Object.fromEntries(COLLECTION_NAMES.map(name => [
        name, parseCollection(localStorage.getItem(prefix + name), (profile === "guest" ? "guest " : "account ") + LABELS[name])
    ]));
}

function fingerprint(record) {
    const clean = {};
    for (const key of Object.keys(record || {}).sort()) {
        if (key === "id" || key.startsWith("migrationSource") || key === "migrationFingerprint") continue;
        clean[key] = record[key];
    }
    return JSON.stringify(clean);
}

function newId() {
    return globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12));
}

function mergeInto(target, incoming, sourceProfile) {
    const byId = new Map(target.filter(record => record.id != null).map(record => [String(record.id), record]));
    let added = 0, duplicates = 0, conflicts = 0;
    for (const original of incoming) {
        const record = { ...original };
        const sourceId = record.id == null ? null : String(record.id);
        const signature = fingerprint(record);

        // Makes retries idempotent when a previous migration had to re-key an ID collision.
        const priorImported = target.some(existing =>
            existing?.migrationSourceProfile === sourceProfile &&
            String(existing?.migrationSourceId ?? "") === String(sourceId ?? "") &&
            existing?.migrationFingerprint === signature
        );
        if (priorImported) { duplicates += 1; continue; }

        const existing = sourceId == null ? null : byId.get(sourceId);
        if (!existing && sourceId != null) {
            target.push(record); byId.set(sourceId, record); added += 1; continue;
        }
        if (existing && JSON.stringify(existing) === JSON.stringify(record)) { duplicates += 1; continue; }

        if (existing) {
            // Same ID but different content: preserve both records by assigning the incoming copy a new ID.
            record.migrationSourceProfile = sourceProfile;
            record.migrationSourceId = sourceId;
            record.migrationFingerprint = signature;
            record.id = newId();
            while (byId.has(String(record.id))) record.id = newId();
            target.push(record); byId.set(String(record.id), record); added += 1; conflicts += 1;
            continue;
        }

        // Legacy record without an ID: give it one rather than risk collisions.
        record.id = newId();
        record.migrationSourceProfile = sourceProfile;
        record.migrationSourceId = null;
        record.migrationFingerprint = signature;
        target.push(record); byId.set(String(record.id), record); added += 1;
    }
    return { added, duplicates, conflicts };
}

function summarize(account, guest, remote = null) {
    const rows = {};
    for (const name of COLLECTION_NAMES) {
        const combined = [...account[name]];
        const cloud = remote?.[name] || [];
        const remoteStats = mergeInto(combined, cloud, "cloud");
        const guestStats = mergeInto(combined, guest[name], "guest");
        rows[name] = {
            account: account[name].length,
            cloud: cloud.length,
            guest: guest[name].length,
            guestToImport: guestStats.added,
            guestDuplicates: guestStats.duplicates,
            guestConflicts: guestStats.conflicts,
            cloudToMerge: remoteStats.added,
            cloudConflicts: remoteStats.conflicts,
            totalAfterMigration: combined.length
        };
    }
    return rows;
}

export function previewGuestMigration(remoteCollections = null) {
    const account = readProfile("account");
    const guest = readProfile("guest");
    return { rows: summarize(account, guest, remoteCollections), hasGuestData: COLLECTION_NAMES.some(name => guest[name].length > 0) };
}

export function migrateGuestDataToAccount({ remoteCollections = null } = {}) {
    if (getStorageProfile() !== "account") throw new Error("Switch to your Google account profile before migrating guest data.");
    const account = readProfile("account");
    const guest = readProfile("guest");
    if (!COLLECTION_NAMES.some(name => guest[name].length > 0)) throw new Error("There is no guest data to migrate.");

    const merged = {};
    const rows = {};
    for (const name of COLLECTION_NAMES) {
        merged[name] = [...account[name]];
        const cloudStats = mergeInto(merged[name], remoteCollections?.[name] || [], "cloud");
        const guestStats = mergeInto(merged[name], guest[name], "guest");
        rows[name] = {
            account: account[name].length,
            cloud: (remoteCollections?.[name] || []).length,
            guest: guest[name].length,
            guestToImport: guestStats.added,
            guestDuplicates: guestStats.duplicates,
            guestConflicts: guestStats.conflicts,
            cloudToMerge: cloudStats.added,
            cloudConflicts: cloudStats.conflicts,
            totalAfterMigration: merged[name].length
        };
    }

    const timestamp = new Date().toISOString();
    const backupKey = BACKUP_PREFIX + timestamp.replace(/[^0-9]/g, "").slice(0, 14);
    const backup = {
        format: "the-glitchcore-chronicle-migration-safety-backup",
        schemaVersion: 1,
        createdAt: timestamp,
        purpose: "Pre-migration account-profile backup. Guest source data is preserved separately.",
        collections: account
    };
    try {
        localStorage.setItem(backupKey, JSON.stringify(backup));
    } catch {
        throw new Error("Could not save the pre-migration safety backup because device storage may be full. Export your current account chronicle and free space before retrying. No data was changed.");
    }

    // replaceCollections has its own rollback and recovery-copy protections.
    // Guest keys are deliberately never changed or removed.
    const counts = replaceCollections(merged);
    return { rows, counts, backupKey, createdAt: timestamp };
}

export function downloadLatestMigrationBackup() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(BACKUP_PREFIX)) keys.push(key);
    }
    keys.sort();
    if (!keys.length) throw new Error("No migration safety backup has been created yet.");
    const key = keys[keys.length - 1];
    const payload = localStorage.getItem(key);
    if (!payload) throw new Error("The saved migration backup could not be read.");
    const blob = new Blob([JSON.stringify(JSON.parse(payload), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tgc-migration-safety-backup-" + key.slice(BACKUP_PREFIX.length) + ".json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return key;
}

export function getLatestMigrationBackupInfo() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(BACKUP_PREFIX)) keys.push(key);
    }
    keys.sort();
    if (!keys.length) return null;
    const key = keys[keys.length - 1];
    try {
        const backup = JSON.parse(localStorage.getItem(key) || "null");
        return backup ? { key, createdAt: backup.createdAt, counts: Object.fromEntries(COLLECTION_NAMES.map(name => [name, backup.collections?.[name]?.length || 0])) } : null;
    } catch { return null; }
}
