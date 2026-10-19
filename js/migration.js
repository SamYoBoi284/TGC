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
    const backupKey = BACKUP_PREFIX + timestamp.replace(/[^0-9]/g, "").slice(0, 14) + "-" + newId().slice(0, 8);
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


async function loadCloudCollections() {
    if (!navigator.onLine) throw new Error("Connect to the internet before migrating. TGC needs to check the account's cloud mirror first so migration cannot overwrite cloud-only records.");
    const { getCurrentUser, connectFirebase, readDoc } = await import("./firebase.js");
    const user = getCurrentUser();
    if (!user) throw new Error("Sign in to your Google account before migrating guest data.");
    const config = (() => {
        try { return JSON.parse(localStorage.getItem("chronicle.settings") || "{}")?.sync?.firebaseConfig || undefined; }
        catch { return undefined; }
    })();
    const connected = await connectFirebase(config);
    if (!connected.ok) throw new Error("Could not inspect your cloud data, so migration was stopped safely: " + connected.error);
    const result = {};
    for (const name of COLLECTION_NAMES) {
        const doc = await readDoc("users/" + user.uid + "/chronicleBackups", name);
        if (doc == null) result[name] = [];
        else if (Array.isArray(doc.records)) result[name] = doc.records;
        else throw new Error("The cloud " + LABELS[name] + " backup is invalid. No migration was performed.");
    }
    return result;
}

function addMigrationSection() {
    const sections = document.getElementById("settingsSections");
    if (!sections || document.getElementById("settingsMigrationSection")) return;
    const section = document.createElement("section");
    section.className = "settingsSection";
    section.id = "settingsMigrationSection";
    section.innerHTML = `
        <h2 class="settingsSectionTitle">Guest data migration</h2>
        <p class="settingsRowHint">Safely merge guest records into your Google account profile. Existing account and cloud records are preserved; conflicting IDs are kept as separate records. Guest data is never deleted.</p>
        <div class="settingsRow">
            <div class="settingsRowLabel">
                <span class="settingsRowTitle">Preview migration</span>
                <span class="settingsRowHint">Compare account, cloud, and guest records before changing anything.</span>
            </div>
            <div class="settingsRowControl"><button type="button" class="settingsBtn settingsBtnGhost" id="settingsMigrationPreviewBtn">Preview</button></div>
        </div>
        <div id="settingsMigrationPreview" class="settingsStorageBreakdown" aria-live="polite"></div>
        <div class="settingsRow">
            <div class="settingsRowLabel">
                <span class="settingsRowTitle">Merge guest data</span>
                <span class="settingsRowHint">Creates a local safety backup first, then merges records without deleting the guest source.</span>
            </div>
            <div class="settingsRowControl"><button type="button" class="settingsBtn" id="settingsMigrationRunBtn">Migrate guest data</button></div>
        </div>
        <div class="settingsRow">
            <div class="settingsRowLabel">
                <span class="settingsRowTitle">Download safety backup</span>
                <span class="settingsRowHint" id="settingsMigrationBackupHint">Downloads the most recent pre-migration account backup, if one exists.</span>
            </div>
            <div class="settingsRowControl"><button type="button" class="settingsBtn settingsBtnGhost" id="settingsMigrationDownloadBackupBtn">Download backup</button></div>
        </div>
        <p id="settingsMigrationStatus" class="settingsStatusText" aria-live="polite"></p>
    `;
    sections.appendChild(section);

    const previewEl = section.querySelector("#settingsMigrationPreview");
    const statusEl = section.querySelector("#settingsMigrationStatus");
    const runBtn = section.querySelector("#settingsMigrationRunBtn");
    const previewBtn = section.querySelector("#settingsMigrationPreviewBtn");
    const downloadBtn = section.querySelector("#settingsMigrationDownloadBackupBtn");
    const status = message => { if (statusEl) statusEl.textContent = message; };
    const isAccount = () => getStorageProfile() === "account";

    function renderPreview(preview) {
        if (!previewEl) return;
        previewEl.innerHTML = COLLECTION_NAMES.map(name => {
            const row = preview.rows[name];
            return `<div class="settingsStorageBreakdownRow"><span>${LABELS[name]} · account ${row.account}, cloud ${row.cloud}, guest ${row.guest}</span><strong>+${row.guestToImport} guest · ${row.guestDuplicates} duplicates · ${row.guestConflicts} ID conflicts</strong></div>`;
        }).join("");
        const guestTotal = Object.values(preview.rows).reduce((sum, row) => sum + row.guest, 0);
        const addTotal = Object.values(preview.rows).reduce((sum, row) => sum + row.guestToImport, 0);
        const conflictTotal = Object.values(preview.rows).reduce((sum, row) => sum + row.guestConflicts + row.cloudConflicts, 0);
        status(`Preview ready: ${guestTotal} guest records found; ${addTotal} guest records will be added; ${conflictTotal} ID conflicts will be preserved as separate records.`);
    }

    previewBtn?.addEventListener("click", async () => {
        previewBtn.disabled = true;
        status("Reading local profiles…");
        try {
            let cloud = null;
            if (isAccount()) cloud = await loadCloudCollections();
            renderPreview(previewGuestMigration(cloud));
            if (!isAccount()) status("Local-only preview shown. Switch to your Google account profile to inspect cloud data and run migration.");
        } catch (err) {
            try { renderPreview(previewGuestMigration()); } catch { /* preserve original error */ }
            status("Cloud-aware preview unavailable: " + (err?.message || "could not inspect data") + (isAccount() ? "" : " · Switch to your Google account to migrate."));
        } finally { previewBtn.disabled = false; }
    });

    runBtn?.addEventListener("click", async () => {
        if (!isAccount()) {
            status("Switch to your Google account profile first. Your guest records remain untouched.");
            return;
        }
        runBtn.disabled = true;
        previewBtn.disabled = true;
        status("Checking local and cloud records…");
        try {
            const cloud = await loadCloudCollections();
            const preview = previewGuestMigration(cloud);
            renderPreview(preview);
            const guestTotal = Object.values(preview.rows).reduce((sum, row) => sum + row.guest, 0);
            const addTotal = Object.values(preview.rows).reduce((sum, row) => sum + row.guestToImport, 0);
            const conflictTotal = Object.values(preview.rows).reduce((sum, row) => sum + row.guestConflicts + row.cloudConflicts, 0);
            if (!guestTotal) { status("No guest records found to migrate."); return; }
            const confirmed = window.confirm(
                "Migrate " + addTotal + " guest record(s) into this account profile?\n\n" +
                "Existing local and cloud records will be merged, not replaced. " + conflictTotal +
                " ID conflict(s) will be kept as separate records. A local safety backup will be saved first. " +
                "Guest source data will remain untouched. Continue?"
            );
            if (!confirmed) { status("Migration cancelled. No data changed."); return; }
            const result = migrateGuestDataToAccount({ remoteCollections: cloud });
            const added = Object.values(result.rows).reduce((sum, row) => sum + row.guestToImport, 0);
            const cloudAdded = Object.values(result.rows).reduce((sum, row) => sum + row.cloudToMerge, 0);
            status("Migration complete: " + added + " guest record(s) added; " + cloudAdded + " cloud-only record(s) merged. Guest source retained. Safety backup saved. Reloading…");
            updateBackupHint();
            window.setTimeout(() => window.location.reload(), 900);
        } catch (err) {
            status("Migration stopped safely: " + (err?.message || "unknown error") + " Guest source data was not deleted.");
        } finally {
            runBtn.disabled = false;
            previewBtn.disabled = false;
        }
    });

    downloadBtn?.addEventListener("click", () => {
        try { downloadLatestMigrationBackup(); status("Migration safety backup downloaded."); }
        catch (err) { status(err?.message || "No backup is available."); }
    });

    function updateBackupHint() {
        const hint = section.querySelector("#settingsMigrationBackupHint");
        const info = getLatestMigrationBackupInfo();
        if (hint) hint.textContent = info
            ? "Latest local safety backup: " + new Date(info.createdAt).toLocaleString() + ". Download it before clearing app data."
            : "Downloads the most recent pre-migration account backup, if one exists.";
        if (downloadBtn) downloadBtn.disabled = !info;
    }
    updateBackupHint();
    if (!isAccount()) {
        runBtn.disabled = true;
        status("Guest profile is active. Preview is available; switch to your Google account profile to run migration.");
    }
}

export function initMigrationUI() {
    addMigrationSection();
}
