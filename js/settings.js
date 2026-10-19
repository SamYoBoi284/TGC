import { COLLECTION_NAMES, readCollectionsSnapshot, replaceCollections, getStorageProfile, clearRecoveryCopies, deleteArchivedRecords } from "./store.js";

// ===========================================
// The Glitchcore Chronicle
// js/settings.js
// MILESTONE 9: Settings
// ===========================================
//
// Settings is its own small local collection (not a record list like
// Entries/Ideas, so it doesn't go through store.js's openCollection —
// it's a single JSON blob, same shape as any other "one object" store).
//
// Sections shipped now:
//   - Appearance: custom background image (jpg/png), UI scale
//   - Data: export everything to a .json file, import it back
//   - About: name, version, tagline
//
// A "Sync" section (Firebase backup/restore via queue.js) is the next
// milestone — this file intentionally leaves a #settingsSyncSection
// mount point and a syncSettings bucket in DEFAULT_SETTINGS ready for
// it, per CLAUDE.md's "leave room, don't build it early" rule.

const STORAGE_KEY = "chronicle.settings";
const APP_VERSION = "0.1.0";

const DEFAULT_SETTINGS = {
    uiScale: 100,
    backgroundImage: null, // data URL (jpg/png) or null
    reducedMotion: false,

    // Electron-only. Ignored (and hidden) when running in a plain
    // browser tab, since window.chronicle?.setMinimizeToTray won't
    // exist there.
    minimizeToTray: true,

    // Milestone 12: Firebase core. Milestone 13 will start writing
    // lastBackupAt for real once the sync queue exists — for now this
    // section just handles connecting and remembering that a project
    // is configured.
    sync: {
        enabled: false,
        lastBackupAt: null,
        firebaseConfig: null // null = use firebase.js's DEFAULT_FIREBASE_CONFIG
    }
};

let current = { ...DEFAULT_SETTINGS };

// ===========================================
// PERSISTENCE
// ===========================================

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        current = raw
            ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw), sync: { ...DEFAULT_SETTINGS.sync, ...(JSON.parse(raw).sync || {}) } }
            : { ...DEFAULT_SETTINGS };
    } catch {
        current = { ...DEFAULT_SETTINGS };
    }
    return current;
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (err) {
        console.warn("Could not persist settings:", err);
    }
}

// Small public API — later milestones (Sync) can read/write settings
// without re-implementing this file's persistence.
export function getSetting(key) {
    return current[key];
}

export function setSetting(key, value) {
    current[key] = value;
    save();
    return value;
}

// ===========================================
// APPLY SIDE EFFECTS
// ===========================================

function applyBackgroundImage(dataUrl) {
    const root = document.documentElement;
    if (dataUrl) {
        root.style.setProperty("--bg-custom-image", `url("${dataUrl}")`);
    } else {
        root.style.setProperty("--bg-custom-image", "none");
    }
}

function applyUiScale(percent) {
    // Previously set document.documentElement.style.fontSize, but
    // every size in this codebase (--font-size-sm/md/lg/xl, spacing,
    // icon sizes, etc.) is a hardcoded px value in variables.css —
    // none of it is defined in rem, so changing the root font-size
    // had no visible effect anywhere. `zoom` scales real rendered
    // pixels directly, so it actually does something. Both Electron
    // (Chromium) and Android Chrome support it — the only environment
    // that wouldn't is Firefox, which this app doesn't target.
    document.documentElement.style.zoom = percent / 100;
}

// Toggles a class on <html> — every animation/transition in the app
// (route-switch fade, mobile drill-down slide, ambient particles)
// checks for this class OR the OS-level prefers-reduced-motion media
// query, so this one setting covers both Electron and the PWA the
// same way regardless of platform.
function applyReducedMotion(enabled) {
    document.documentElement.classList.toggle("chronicle-reduced-motion", !!enabled);
}

function applyMinimizeToTray(enabled) {
    // No-op outside Electron (plain browser tab) — window.chronicle
    // is only exposed by preload.js.
    window.chronicle?.setMinimizeToTray?.(enabled);
}

function applyAll() {
    applyBackgroundImage(current.backgroundImage);
    applyUiScale(current.uiScale);
    applyReducedMotion(current.reducedMotion);
    applyMinimizeToTray(current.minimizeToTray);
}

// ===========================================
// RENDER
// ===========================================

function render() {
    const mount = document.getElementById("settingsPage");
    if (!mount) return;

    mount.innerHTML = `
        <div id="settingsHeader">
            <h1>Settings</h1>
            <p id="settingsSubtitle">Make this chronicle feel like yours.</p>
        </div>

        <div id="settingsSections">

            <section class="settingsSection" id="settingsGeneralSection" hidden>
                <h2 class="settingsSectionTitle">General</h2>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Minimize to tray</span>
                        <span class="settingsRowHint">Keeps Chronicle running in the background — closing or minimizing the window hides it to the system tray instead of quitting. Right-click the tray icon to reopen or quit for real.</span>
                    </div>
                    <div class="settingsRowControl">
                        <input type="checkbox" id="settingsMinimizeToTrayInput">
                    </div>
                </div>
            </section>

            <section class="settingsSection">
                <h2 class="settingsSectionTitle">Appearance</h2>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Background image</span>
                        <span class="settingsRowHint">JPG or PNG. Sits behind the whole app.</span>
                    </div>
                    <div class="settingsRowControl" id="settingsBgControl">
                        <input type="file" id="settingsBgInput" accept="image/jpeg,image/png" hidden>
                        <button type="button" class="settingsBtn" id="settingsBgChooseBtn">Choose image</button>
                        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsBgClearBtn">Remove</button>
                    </div>
                </div>
                <div id="settingsBgPreviewWrap" class="settingsBgPreviewWrap">
                    <div id="settingsBgPreview" class="settingsBgPreview"></div>
                </div>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">UI scale</span>
                        <span class="settingsRowHint" id="settingsScaleHint">100%</span>
                    </div>
                    <div class="settingsRowControl">
                        <input type="range" id="settingsScaleInput" min="80" max="130" step="5">
                    </div>
                </div>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Reduced motion</span>
                        <span class="settingsRowHint">Turns off the ambient background particles and the route/panel transition animations. Applies on both desktop and mobile.</span>
                    </div>
                    <div class="settingsRowControl">
                        <input type="checkbox" id="settingsReducedMotionInput">
                    </div>
                </div>
            </section>

            <section class="settingsSection">
                <h2 class="settingsSectionTitle">Data</h2>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Export your chronicle</span>
                        <span class="settingsRowHint">Saves every entry, brain dump, milestone, and idea to a .json file.</span>
                    </div>
                    <div class="settingsRowControl">
                        <button type="button" class="settingsBtn" id="settingsExportBtn">Export</button>
                    </div>
                </div>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Import a chronicle file</span>
                        <span class="settingsRowHint">Restores from a previously exported .json file.</span>
                    </div>
                    <div class="settingsRowControl">
                        <input type="file" id="settingsImportInput" accept="application/json" hidden>
                        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsImportBtn">Import</button>
                    </div>
                </div>

                <p id="settingsDataStatus" class="settingsStatusText"></p>
            </section>

            <section class="settingsSection" id="settingsStorageSection">
                <h2 class="settingsSectionTitle">Local storage</h2>
                <p class="settingsRowHint">Manage TGC's local browser storage. Sizes are estimates, not your phone's full app-storage total.</p>
                <div id="settingsStorageSummary" class="settingsStorageSummary">Calculating…</div>
                <div id="settingsStorageBreakdown" class="settingsStorageBreakdown"></div>
                <div class="settingsRow"><div class="settingsRowLabel"><span class="settingsRowTitle">Remove recovery copies</span><span class="settingsRowHint">Frees space used by safety copies. Current records remain, but older recovery copies will no longer be available.</span></div><div class="settingsRowControl"><button type="button" class="settingsBtn settingsBtnGhost" id="settingsStorageClearRecoveryBtn">Clear copies</button></div></div>
                <div class="settingsRow"><div class="settingsRowLabel"><span class="settingsRowTitle">Delete archived records</span><span class="settingsRowHint">Permanently removes archived records from this profile. Export a backup first.</span></div><div class="settingsRowControl"><button type="button" class="settingsBtn settingsBtnGhost" id="settingsStorageDeleteArchivedBtn">Delete archived</button></div></div>
                <div class="settingsRow"><div class="settingsRowLabel"><span class="settingsRowTitle">Custom background image</span><span class="settingsRowHint">Large images are stored inside app settings. Removing it frees local space.</span></div><div class="settingsRowControl"><button type="button" class="settingsBtn settingsBtnGhost" id="settingsStorageClearBackgroundBtn">Remove image</button></div></div>
                <div class="settingsRow"><div class="settingsRowLabel"><span class="settingsRowTitle">Refresh storage estimate</span><span class="settingsRowHint">Recalculate the local storage breakdown.</span></div><div class="settingsRowControl"><button type="button" class="settingsBtn" id="settingsStorageRefreshBtn">Refresh</button></div></div>
                <p id="settingsStorageStatus" class="settingsStatusText" aria-live="polite"></p>
            </section>

            <section class="settingsSection" id="settingsSyncSection">
                <h2 class="settingsSectionTitle">Sync</h2>
                <p class="settingsRowHint">Your chronicle is local-first. Cloud backup is opt-in. Guest mode uses a separate local profile and never sends guest data to Firestore.</p>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Account</span>
                        <span class="settingsRowHint" id="settingsAuthHint">Not signed in.</span>
                    </div>
                    <div class="settingsRowControl">
                        <button type="button" class="settingsBtn" id="settingsSignInBtn">Sign in with Google</button>
                        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsSignOutBtn" hidden>Log out</button>
                        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsGuestModeBtn" hidden>Switch to guest mode</button>
                    </div>
                </div>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Cloud backup</span>
                        <span class="settingsRowHint">Connects to Firestore so your chronicle is reachable from another device, using your signed-in account.</span>
                    </div>
                    <div class="settingsRowControl">
                        <input type="checkbox" id="settingsSyncEnabledInput">
                    </div>
                </div>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Test connection</span>
                        <span class="settingsRowHint">Confirms Chronicle can reach your Firebase project right now.</span>
                    </div>
                    <div class="settingsRowControl">
                        <button type="button" class="settingsBtn" id="settingsSyncTestBtn">Test connection</button>
                    </div>
                </div>

                <p id="settingsSyncStatus" class="settingsStatusText"></p>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Back up now</span>
                        <span class="settingsRowHint">Pushes everything to Firebase right now.</span>
                    </div>
                    <div class="settingsRowControl">
                        <button type="button" class="settingsBtn" id="settingsSyncBackupBtn">Back Up Now</button>
                    </div>
                </div>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Restore from a backup</span>
                        <span class="settingsRowHint">Each Back Up Now saves a new dated snapshot — nothing is overwritten. Pick one below to restore it.</span>
                    </div>
                    <div class="settingsRowControl">
                        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsSyncListSnapshotsBtn">Show backups</button>
                    </div>
                </div>

                <div id="settingsSyncSnapshotsList" class="settingsSnapshotsList"></div>

                <p id="settingsSyncQueueStatus" class="settingsStatusText"></p>
            </section>

            <section class="settingsSection">
                <h2 class="settingsSectionTitle">About</h2>
                <div class="settingsAboutBlock">
                    <p id="settingsAboutName">The Glitchcore Chronicle</p>
                    <p id="settingsAboutTagline">A private digital chronicle.</p>
                    <p id="settingsAboutVersion">Version ${APP_VERSION}</p>
                </div>
            </section>

        </div>
    `;

    bindEvents();
    reflectCurrentValues();
}

function reflectCurrentValues() {
    const scaleInput = document.getElementById("settingsScaleInput");
    const scaleHint = document.getElementById("settingsScaleHint");
    if (scaleInput) scaleInput.value = current.uiScale;
    if (scaleHint) scaleHint.textContent = `${current.uiScale}%`;

    const reducedMotionInput = document.getElementById("settingsReducedMotionInput");
    if (reducedMotionInput) reducedMotionInput.checked = !!current.reducedMotion;

    const syncEnabledInput = document.getElementById("settingsSyncEnabledInput");
    const guestMode = getStorageProfile() === "guest";
    if (syncEnabledInput) { syncEnabledInput.checked = !!current.sync.enabled; syncEnabledInput.disabled = guestMode; }
    for (const id of ["settingsSyncTestBtn", "settingsSyncBackupBtn", "settingsSyncListSnapshotsBtn"]) {
        const control = document.getElementById(id); if (control) control.disabled = guestMode;
    }
    const syncHint = document.querySelector("#settingsSyncSection > .settingsRowHint");
    if (syncHint && guestMode) syncHint.textContent = "Guest mode is isolated and local-only. Switch to a Google account to use cloud backup or restore.";

    // Only meaningful (and only present) in Electron — a plain browser
    // tab has no tray to minimize to.
    const generalSection = document.getElementById("settingsGeneralSection");
    const minimizeToTrayInput = document.getElementById("settingsMinimizeToTrayInput");
    if (window.chronicle) {
        if (generalSection) generalSection.hidden = false;
        if (minimizeToTrayInput) minimizeToTrayInput.checked = !!current.minimizeToTray;
    }

    renderBgPreview();
    reflectAuthState();
    renderStorageReport();
}

function renderBgPreview() {
    const wrap = document.getElementById("settingsBgPreviewWrap");
    const preview = document.getElementById("settingsBgPreview");
    const clearBtn = document.getElementById("settingsBgClearBtn");
    if (!wrap || !preview) return;

    if (current.backgroundImage) {
        preview.style.backgroundImage = `url("${current.backgroundImage}")`;
        wrap.classList.add("settingsBgPreviewWrapActive");
        if (clearBtn) clearBtn.disabled = false;
    } else {
        preview.style.backgroundImage = "none";
        wrap.classList.remove("settingsBgPreviewWrapActive");
        if (clearBtn) clearBtn.disabled = true;
    }
}

// ===========================================
// EVENTS
// ===========================================

function bindEvents() {
    const bgInput = document.getElementById("settingsBgInput");
    const bgChooseBtn = document.getElementById("settingsBgChooseBtn");
    const bgClearBtn = document.getElementById("settingsBgClearBtn");
    const scaleInput = document.getElementById("settingsScaleInput");
    const exportBtn = document.getElementById("settingsExportBtn");
    const importBtn = document.getElementById("settingsImportBtn");
    const importInput = document.getElementById("settingsImportInput");

    const minimizeToTrayInput = document.getElementById("settingsMinimizeToTrayInput");
    minimizeToTrayInput?.addEventListener("change", () => {
        current.minimizeToTray = minimizeToTrayInput.checked;
        save();
        applyMinimizeToTray(current.minimizeToTray);
    });

    bgChooseBtn?.addEventListener("click", () => bgInput?.click());

    bgInput?.addEventListener("change", () => {
        const file = bgInput.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            current.backgroundImage = reader.result;
            save();
            applyBackgroundImage(current.backgroundImage);
            renderBgPreview();
        };
        reader.readAsDataURL(file);
        bgInput.value = "";
    });

    // Wallpaper removal is bound once below for both Appearance and Storage.
    void bgClearBtn;

    scaleInput?.addEventListener("input", () => {
        const value = Number(scaleInput.value);
        current.uiScale = value;
        save();
        applyUiScale(value);
        const hint = document.getElementById("settingsScaleHint");
        if (hint) hint.textContent = `${value}%`;
    });

    const reducedMotionInput = document.getElementById("settingsReducedMotionInput");
    reducedMotionInput?.addEventListener("change", () => {
        current.reducedMotion = reducedMotionInput.checked;
        save();
        applyReducedMotion(current.reducedMotion);
    });

    exportBtn?.addEventListener("click", handleExport);
    importBtn?.addEventListener("click", () => importInput?.click());
    importInput?.addEventListener("change", handleImportFileChosen);

    document.getElementById("settingsStorageRefreshBtn")?.addEventListener("click", renderStorageReport);
    document.getElementById("settingsStorageClearRecoveryBtn")?.addEventListener("click", () => {
        if (!window.confirm("Remove all recovery copies for this profile? Current records remain, but older safety copies cannot be restored afterward.")) return;
        try { const removed = clearRecoveryCopies(); setStorageStatus(removed ? "Removed " + removed + " recovery cop" + (removed === 1 ? "y." : "ies.") : "No recovery copies to remove."); renderStorageReport(); }
        catch (err) { setStorageStatus("Could not clear recovery copies: " + (err?.message || "storage error")); }
    });
    document.getElementById("settingsStorageDeleteArchivedBtn")?.addEventListener("click", () => {
        if (!window.confirm("Permanently delete all archived records in this profile? Export a JSON backup first if you may want them later. This cannot be undone.")) return;
        try { const counts = deleteArchivedRecords(); const total = Object.values(counts).reduce((sum, count) => sum + count, 0); setStorageStatus(total ? "Permanently deleted " + total + " archived record" + (total === 1 ? "." : "s.") : "No archived records found."); renderStorageReport(); }
        catch (err) { setStorageStatus("Archived cleanup failed: " + (err?.message || "local data could not be read")); }
    });
    document.getElementById("settingsStorageClearBackgroundBtn")?.addEventListener("click", clearBackgroundImage);
    document.getElementById("settingsBgClearBtn")?.addEventListener("click", clearBackgroundImage);

    const syncEnabledInput = document.getElementById("settingsSyncEnabledInput");
    const syncTestBtn = document.getElementById("settingsSyncTestBtn");

    syncEnabledInput?.addEventListener("change", async () => {
        current.sync.enabled = syncEnabledInput.checked;
        save();

        if (!current.sync.enabled) {
            setSyncStatus("Cloud backup off. Firebase won't be loaded.");
            return;
        }

        setSyncStatus("Connecting…");
        const { connectFirebase } = await import("./firebase.js");
        const result = await connectFirebase(current.sync.firebaseConfig || undefined);
        setSyncStatus(result.ok
            ? "Connected. (Manual backup arrives next milestone.)"
            : `Couldn't connect: ${result.error}`);
    });

    syncTestBtn?.addEventListener("click", async () => {
        setSyncStatus("Testing…");
        const { testConnection } = await import("./firebase.js");
        const result = await testConnection(current.sync.firebaseConfig || undefined);
        setSyncStatus(result.ok ? "Connection OK." : `Test failed: ${result.error}`);
    });

    const syncBackupBtn = document.getElementById("settingsSyncBackupBtn");
    const syncListSnapshotsBtn = document.getElementById("settingsSyncListSnapshotsBtn");
    const signInBtn = document.getElementById("settingsSignInBtn");
    const signOutBtn = document.getElementById("settingsSignOutBtn");

    signInBtn?.addEventListener("click", async () => {
        const wasGuest = getStorageProfile() === "guest";
        if (wasGuest) localStorage.setItem("chronicle.accessMode", "account");
        setSyncStatus("Opening Google sign-in…");
        const { signInWithGoogle } = await import("./firebase.js");
        const result = await signInWithGoogle(current.sync.firebaseConfig || undefined);
        if (result.ok) {
            if (wasGuest && !result.redirecting) window.location.reload();
            setSyncStatus(result.redirecting ? "Redirecting to Google…" : "Switching to your account profile…");
        } else {
            if (wasGuest) localStorage.setItem("chronicle.accessMode", "guest");
            setSyncStatus(`Sign-in failed: ${result.error}`);
        }
        reflectAuthState();
    });

    signOutBtn?.addEventListener("click", async () => {
        const { signOutUser } = await import("./firebase.js");
        await signOutUser();
        setSyncStatus("Signed out.");
        reflectAuthState();
    });

    document.getElementById("settingsGuestModeBtn")?.addEventListener("click", async () => {
        if (!window.confirm("Switch to guest mode? Your account chronicle will remain untouched. Guest mode uses a separate local profile and cloud backup will be unavailable until you switch back.")) return;
        localStorage.setItem("chronicle.accessMode", "guest");
        const { getCurrentUser, signOutUser } = await import("./firebase.js");
        if (getCurrentUser()) {
            const result = await signOutUser();
            if (!result.ok) { localStorage.setItem("chronicle.accessMode", "account"); setSyncStatus("Could not switch to guest mode: " + (result.error || "sign-out failed")); return; }
        }
        window.location.reload();
    });

    reflectAuthState();

    syncBackupBtn?.addEventListener("click", async () => {
        setSyncStatus("Backing up…");
        const { backupNow } = await import("./syncqueue.js");
        const result = await backupNow();
        setSyncStatus(result.ok
            ? `Backed up ${result.queued} collections as a new snapshot.`
            : result.error);
        // If the snapshot list is currently open, refresh it so the
        // one that was just created shows up right away.
        if (document.getElementById("settingsSyncSnapshotsList")?.childElementCount) {
            loadAndRenderSnapshots();
        }
    });

    syncListSnapshotsBtn?.addEventListener("click", loadAndRenderSnapshots);
}

async function loadAndRenderSnapshots() {
    const listEl = document.getElementById("settingsSyncSnapshotsList");
    if (!listEl) return;

    listEl.innerHTML = `<p class="settingsStatusText">Loading backups…</p>`;

    try {
        const { listSnapshots } = await import("./syncqueue.js");
        const snapshots = await listSnapshots();
        renderSnapshotsList(snapshots);
    } catch (err) {
        console.warn("Could not list snapshots:", err);
        listEl.innerHTML = `<p class="settingsStatusText">${err?.message || "Couldn't load backups."}</p>`;
    }
}

const COLLECTION_LABELS = {
    entries: "entries",
    braindump: "brain dump",
    milestones: "milestones",
    ideas: "ideas"
};

function renderSnapshotsList(snapshots) {
    const listEl = document.getElementById("settingsSyncSnapshotsList");
    if (!listEl) return;

    if (!snapshots.length) {
        listEl.innerHTML = `<p class="settingsStatusText">No backups yet — hit Back Up Now to create one.</p>`;
        return;
    }

    listEl.innerHTML = snapshots.map(snap => {
        const when = new Date(snap.createdAt).toLocaleString();
        const summary = Object.entries(snap.counts)
            .map(([name, count]) => `${count} ${COLLECTION_LABELS[name] || name}`)
            .join(" · ");
        return `
            <div class="settingsSnapshotRow" data-snapshot-id="${snap.id}">
                <div class="settingsSnapshotInfo">
                    <span class="settingsSnapshotWhen">${when}</span>
                    <span class="settingsSnapshotSummary">${summary}</span>
                </div>
                <button type="button" class="settingsBtn settingsBtnGhost settingsSnapshotRestoreBtn">Restore</button>
            </div>
        `;
    }).join("");

    listEl.querySelectorAll(".settingsSnapshotRestoreBtn").forEach(btn => {
        btn.addEventListener("click", () => {
            const snapshotId = btn.closest(".settingsSnapshotRow")?.dataset.snapshotId;
            if (snapshotId) handleRestoreSnapshot(snapshotId);
        });
    });
}

async function handleRestoreSnapshot(snapshotId) {
    const confirmed = window.confirm(
        "Restoring will replace your current entries, brain dump, milestones, and ideas with this backup. This can't be undone. Continue?"
    );
    if (!confirmed) return;

    setSyncStatus("Restoring…");
    const { restoreSnapshot } = await import("./syncqueue.js");
    try {
        await restoreSnapshot(snapshotId);
        setSyncStatus("Restored. Reloading…");
        setTimeout(() => window.location.reload(), 600);
    } catch (err) {
        console.warn("Restore failed:", err);
        setSyncStatus(`Restore failed: ${err?.message || "unknown error"}`);
    }
}

function setSyncStatus(text) {
    const el = document.getElementById("settingsSyncStatus");
    if (el) el.textContent = text;
}

async function reflectAuthState() {
    const hint = document.getElementById("settingsAuthHint"), signInBtn = document.getElementById("settingsSignInBtn"), signOutBtn = document.getElementById("settingsSignOutBtn"), guestModeBtn = document.getElementById("settingsGuestModeBtn");
    if (!hint || !signInBtn || !signOutBtn) return;
    if (getStorageProfile() === "guest") {
        hint.textContent = "Guest mode — local-only data, separate from your Google account.";
        signInBtn.textContent = "Switch to Google account"; signInBtn.hidden = false; signOutBtn.hidden = true;
        if (guestModeBtn) guestModeBtn.hidden = true;
        return;
    }
    try {
        const { getCurrentUser } = await import("./firebase.js"); const user = getCurrentUser();
        if (user) {
            hint.textContent = `Signed in as ${user.email}.`; signInBtn.hidden = true; signOutBtn.hidden = false;
            if (guestModeBtn) guestModeBtn.hidden = false;
        } else {
            hint.textContent = "Not signed in."; signInBtn.textContent = "Sign in with Google"; signInBtn.hidden = false; signOutBtn.hidden = true;
            if (guestModeBtn) guestModeBtn.hidden = true;
        }
    } catch { /* firebase.js not loaded yet — stays at default copy */ }
}

function setDataStatus(text) {
    const el = document.getElementById("settingsDataStatus"); if (el) el.textContent = text;
}
function setStorageStatus(text) { const el = document.getElementById("settingsStorageStatus"); if (el) el.textContent = text; }
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"; if (bytes < 1024) return bytes + " B";
    const units = ["KB", "MB", "GB"]; let size = bytes / 1024, index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return size.toFixed(size >= 10 ? 1 : 2) + " " + units[index];
}
function renderStorageReport() {
    const summary = document.getElementById("settingsStorageSummary"), breakdown = document.getElementById("settingsStorageBreakdown"); if (!summary || !breakdown) return;
    try {
        const profile = getStorageProfile(), bytes = value => new TextEncoder().encode(value || "").length, included = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const name = localStorage.key(i); if (!name) continue;
            const relevant = profile === "guest" ? name.startsWith("chronicle.guest.") || name === STORAGE_KEY : name.startsWith("chronicle.") && !name.startsWith("chronicle.guest.");
            if (relevant) included.push({ name, value: localStorage.getItem(name) || "" });
        }
        const totals = { collections: 0, recovery: 0, background: 0, sync: 0, other: 0 };
        for (const item of included) {
            const size = bytes(item.name) + bytes(item.value);
            if (COLLECTION_NAMES.some(name => item.name === (profile === "guest" ? "chronicle.guest." + name : "chronicle." + name))) totals.collections += size;
            else if (item.name.includes(".recovery.")) totals.recovery += size;
            else if (item.name === STORAGE_KEY) { const imageBytes = bytes(current.backgroundImage || ""); totals.background += Math.min(size, imageBytes); totals.other += Math.max(0, size - imageBytes); }
            else if (item.name === "chronicle.syncQueue") totals.sync += size; else totals.other += size;
        }
        const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
        summary.textContent = "Estimated TGC local storage · " + (profile === "guest" ? "Guest profile" : "Account profile") + ": " + formatBytes(total);
        breakdown.innerHTML = [["Chronicle collections",totals.collections],["Recovery copies",totals.recovery],["Custom background image",totals.background],["Sync queue",totals.sync],["Other TGC settings",totals.other]].map(([label,size]) => `<div class="settingsStorageBreakdownRow"><span>${label}</span><strong>${formatBytes(size)}</strong></div>`).join("");
        const recoveryBtn = document.getElementById("settingsStorageClearRecoveryBtn"); if (recoveryBtn) recoveryBtn.disabled = totals.recovery === 0;
        const archivedBtn = document.getElementById("settingsStorageDeleteArchivedBtn"); if (archivedBtn) archivedBtn.disabled = totals.collections === 0;
        const bgBtn = document.getElementById("settingsStorageClearBackgroundBtn"); if (bgBtn) bgBtn.disabled = !current.backgroundImage;
    } catch (err) { summary.textContent = "Storage usage could not be measured."; breakdown.textContent = err?.message || "Local storage is unavailable."; }
}
function clearBackgroundImage() {
    if (!current.backgroundImage) { renderStorageReport(); return; }
    current.backgroundImage = null; save(); applyBackgroundImage(null); renderBgPreview(); setStorageStatus("Custom background image removed."); renderStorageReport();
}

function handleExport() {
    let collections;
    try { collections = readCollectionsSnapshot(); }
    catch (err) {
        console.warn("Chronicle export stopped:", err);
        setDataStatus("Export failed: " + (err?.message || "local data could not be read"));
        return;
    }
    const payload = {
        format: "the-glitchcore-chronicle-backup",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        collections
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "glitchcore-chronicle-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDataStatus("Local backup exported.");
}

function handleImportFileChosen() {
    const input = document.getElementById("settingsImportInput");
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(String(reader.result || ""));
            const collections = parsed?.collections;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
                !collections || typeof collections !== "object" || Array.isArray(collections)) {
                throw new Error("The selected file is not a valid Chronicle backup.");
            }
            for (const name of COLLECTION_NAMES) {
                if (!Array.isArray(collections[name])) throw new Error("The backup is missing the " + name + " collection.");
            }
            if (!window.confirm("Importing will replace your current entries, brain dump, milestones, and ideas with the contents of this file. A recovery copy of current local data will be kept where possible. Continue?")) {
                setDataStatus("Import cancelled.");
                return;
            }
            const counts = replaceCollections(collections);
            const summary = Object.entries(counts).map(([name, count]) => count + " " + name).join(", ");
            setDataStatus("Imported successfully (" + summary + "). Reloading…");
            setTimeout(() => window.location.reload(), 800);
        } catch (err) {
            console.warn("Chronicle import failed:", err);
            setDataStatus("Import failed: " + (err?.message || "That file could not be read"));
        }
    };
    reader.onerror = () => setDataStatus("Import failed: the selected file could not be read.");
    reader.readAsText(file);
    input.value = "";
}

// ===========================================
// INIT
// ===========================================

export function initSettings() {
    load();
    render();
    applyAll();

    // If Cloud Backup was already on, pick the signed-in session back
    // up automatically (Firebase persists it same-origin) instead of
    // leaving Sync looking "signed out" until the user re-signs-in —
    // this is what makes the post-restore reload (and any normal
    // app relaunch) not silently drop the session.
    if (current.sync.enabled) {
        import("./firebase.js").then(async ({ restoreAuthSession }) => {
            await restoreAuthSession(current.sync.firebaseConfig || undefined);
            reflectAuthState();
        });
    }
}
