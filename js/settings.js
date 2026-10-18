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

            <section class="settingsSection" id="settingsSyncSection">
                <h2 class="settingsSectionTitle">Sync</h2>
                <p class="settingsRowHint">Offline-first stays the default for your data. Cloud backup itself is still opt-in — signing in is required just to open the app, but nothing is sent to Firestore unless you turn Cloud backup on below.</p>

                <div class="settingsRow">
                    <div class="settingsRowLabel">
                        <span class="settingsRowTitle">Account</span>
                        <span class="settingsRowHint" id="settingsAuthHint">Not signed in.</span>
                    </div>
                    <div class="settingsRowControl">
                        <button type="button" class="settingsBtn" id="settingsSignInBtn">Sign in with Google</button>
                        <button type="button" class="settingsBtn settingsBtnGhost" id="settingsSignOutBtn" hidden>Log out</button>
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
    if (syncEnabledInput) syncEnabledInput.checked = !!current.sync.enabled;

    // Only meaningful (and only present) in Electron — a plain browser
    // tab has no tray to minimize to.
    const generalSection = document.getElementById("settingsGeneralSection");
    const minimizeToTrayInput = document.getElementById("settingsMinimizeToTrayInput");
    if (window.chronicle) {
        if (generalSection) generalSection.hidden = false;
        if (minimizeToTrayInput) minimizeToTrayInput.checked = !!current.minimizeToTray;
    }

    renderBgPreview();
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

    bgClearBtn?.addEventListener("click", () => {
        current.backgroundImage = null;
        save();
        applyBackgroundImage(null);
        renderBgPreview();
    });

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
        setSyncStatus("Opening Google sign-in…");
        const { signInWithGoogle } = await import("./firebase.js");
        const result = await signInWithGoogle(current.sync.firebaseConfig || undefined);
        setSyncStatus(result.ok ? `Signed in as ${result.user.email}.` : `Sign-in failed: ${result.error}`);
        reflectAuthState();
    });

    signOutBtn?.addEventListener("click", async () => {
        const { signOutUser } = await import("./firebase.js");
        await signOutUser();
        setSyncStatus("Signed out.");
        reflectAuthState();
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
    const hint = document.getElementById("settingsAuthHint");
    const signInBtn = document.getElementById("settingsSignInBtn");
    const signOutBtn = document.getElementById("settingsSignOutBtn");
    if (!hint || !signInBtn || !signOutBtn) return;

    try {
        const { getCurrentUser } = await import("./firebase.js");
        const user = getCurrentUser();
        if (user) {
            hint.textContent = `Signed in as ${user.email}.`;
            signInBtn.hidden = true;
            signOutBtn.hidden = false;
        } else {
            hint.textContent = "Not signed in.";
            signInBtn.hidden = false;
            signOutBtn.hidden = true;
        }
    } catch { /* firebase.js not loaded yet — stays at default copy */ }
}

function setDataStatus(text) {
    const el = document.getElementById("settingsDataStatus");
    if (el) el.textContent = text;
}

const EXPORTED_COLLECTIONS = ["entries", "braindump", "milestones", "ideas"];

function handleExport() {
    const payload = {
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        collections: {}
    };

    EXPORTED_COLLECTIONS.forEach(name => {
        try {
            const raw = localStorage.getItem(`chronicle.${name}`);
            payload.collections[name] = raw ? JSON.parse(raw) : [];
        } catch {
            payload.collections[name] = [];
        }
    });

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `glitchcore-chronicle-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setDataStatus("Exported.");
}

function handleImportFileChosen() {
    const input = document.getElementById("settingsImportInput");
    const file = input?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            const collections = parsed.collections || {};

            const confirmed = window.confirm(
                "Importing will replace your current entries, brain dump, milestones, and ideas with the contents of this file. This can't be undone. Continue?"
            );
            if (!confirmed) {
                setDataStatus("Import cancelled.");
                return;
            }

            EXPORTED_COLLECTIONS.forEach(name => {
                if (Array.isArray(collections[name])) {
                    localStorage.setItem(`chronicle.${name}`, JSON.stringify(collections[name]));
                }
            });

            setDataStatus("Imported. Reloading…");
            setTimeout(() => window.location.reload(), 600);
        } catch (err) {
            console.warn("Import failed:", err);
            setDataStatus("That file couldn't be read as a chronicle backup.");
        }
    };
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
