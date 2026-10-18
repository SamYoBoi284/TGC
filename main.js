// ===========================================
// The Glitchcore Chronicle
// main.js — Electron main process
// MILESTONE 1: Foundation
// ===========================================
//
// Responsibilities of this file, and only this file:
// - create the app window
// - wire up the preload bridge
// - own app lifecycle (quit behavior, single window)
//
// Nothing about UI, theming, or feature logic belongs here.
// That all lives in the renderer (index.html + js/*.js + css/*.css).

const { app, BrowserWindow, Tray, Menu, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

let mainWindow = null;
let server = null;
let tray = null;

const trayIconPath = path.join(__dirname, "assets", "tray-icon.png");

// ===========================================
// SINGLE INSTANCE LOCK
// ===========================================
// Without this, launching the app a second time while it's already
// minimized to tray would spawn a whole new process instead of just
// bringing the existing (hidden) window back. app.exit() is used
// instead of app.quit() in the losing process so it terminates
// immediately rather than racing the still-pending
// app.whenReady().then(createWindow) below.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    app.exit(0);
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    });
}

const MIME_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
};

// Firebase Auth's signInWithPopup/signInWithRedirect refuse to run
// under file:// (both the "location.protocol must be http/https"
// check and Firebase's authorized-domain check fail on file://).
// Serving over http://localhost sidesteps both — localhost is
// auto-authorized on every Firebase project, no console config
// needed. This is local-only: the server binds to 127.0.0.1 and
// isn't reachable from outside the machine.
function startLocalServer() {
    return new Promise(resolve => {
        server = http.createServer((req, res) => {
            let filePath = path.join(__dirname, decodeURIComponent(req.url.split("?")[0]));
            if (req.url === "/") filePath = path.join(__dirname, "index.html");

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }
                const ext = path.extname(filePath);
                res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
                res.end(data);
            });
        });

        server.listen(0, "127.0.0.1", () => {
            resolve(server.address().port);
        });
    });
}

// Known Electron/Chromium bug (electron/electron#19977, #40212): after
// a native alert()/confirm()/prompt() closes, the renderer can lose
// real keyboard input routing until the window loses and regains OS
// focus. Only called right after preload.js reports one of those
// dialogs actually closed (see the IPC handler below) — not on every
// ordinary window focus/Alt+Tab, which would cause visible flicker.
function restoreWindowFocus() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();

        mainWindow.blur();
        mainWindow.focus();
        mainWindow.webContents.focus();
    }, 50);
}

// Native JS dialogs triggered from the renderer (alert()/confirm()/
// prompt()) don't go through main.js at all — they're shown by
// Chromium itself. preload.js wraps all three centrally and pings
// this the instant one closes.
ipcMain.on("chronicle:restore-focus-after-dialog", () => {
    restoreWindowFocus();
});

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: "#0a0710", // matches --bg-base, avoids white flash on load
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    // AUTH GATE: Firebase's signInWithPopup opens accounts.google.com
    // (and briefly the authDomain's own helper page) via window.open.
    // Electron 14+ denies all window.open calls by default unless a
    // handler explicitly allows them — without this, the sign-in
    // popup is silently swallowed and the login screen just spins
    // forever. Only these two origins are allowed through; everything
    // else (any link a user might click inside the app) still opens
    // in the OS's default browser instead of a new Electron window.
    const ALLOWED_POPUP_ORIGINS = [
        "https://accounts.google.com",
        "https://the-glitchcore-chronicle.firebaseapp.com"
    ];
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const origin = new URL(url).origin;
            if (ALLOWED_POPUP_ORIGINS.includes(origin)) {
                return { action: "allow" };
            }
        } catch { /* fall through to deny */ }
        return { action: "deny" };
    });

    const port = await startLocalServer();
    mainWindow.loadURL(`http://localhost:${port}/index.html`);

    // Wait for content to paint before showing — avoids the blank-window flash.
    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    // Settings feature: General > "Minimize to tray". When on, both
    // minimizing and clicking the window's close (X) button hide the
    // window to the tray instead of actually closing/quitting it — the
    // app keeps running in the background so sync/backup can keep
    // working unattended. Only the tray menu's "Quit" (or Cmd+Q on
    // macOS) really exits. When the setting is off, minimize/close
    // behave like a normal window.
    mainWindow.on("minimize", (event) => {
        if (getMinimizeToTray() && tray) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on("close", (event) => {
        if (getMinimizeToTray() && tray && !app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // Focus-regain fix (ESM's approach): after a native dialog
    // (alert/confirm/prompt, file picker, OAuth popup, etc.) closes,
    // Chromium doesn't reliably re-sync keyboard input to the page's
    // active element — clicks work but typing into textareas stays
    // dead until restart. Just calling mainWindow.focus() on the
    // window's own "focus" event is a no-op here, since Electron
    // already considers the window focused; only a genuine
    // blur -> focus transition (what Alt+Tab does) forces Chromium to
    // re-sync. So instead of listening for every window "focus"
    // event, preload.js pings "chronicle:restore-focus-after-dialog"
    // right after alert()/confirm()/prompt() actually closes, and
    // that's the only thing that triggers this.
}

// ===========================================
// MINIMIZE TO TRAY
// ===========================================
// Settings feature: General > "Minimize to tray". Renderer's
// settings.js pushes this via the "chronicle:set-minimize-to-tray"
// IPC message on startup and whenever the toggle changes; kept as a
// plain in-memory mirror here so the window event handlers above
// don't need to reach into the renderer's localStorage themselves.
let minimizeToTray = true;

function getMinimizeToTray() {
    return minimizeToTray;
}

function syncTrayState() {
    if (minimizeToTray && !tray) {
        createTray();
    } else if (!minimizeToTray && tray) {
        tray.destroy();
        tray = null;
    }
}

function createTray() {
    if (tray) return;

    tray = new Tray(trayIconPath);
    tray.setToolTip("The Glitchcore Chronicle");

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Open",
            click: () => {
                if (!mainWindow) return;
                mainWindow.show();
                mainWindow.focus();
            }
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on("click", () => {
        if (!mainWindow) return;
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
}

// settings.js calls this once at startup (with whatever's saved in
// localStorage) and again every time the toggle changes.
ipcMain.handle("chronicle:set-minimize-to-tray", (_event, enabled) => {
    minimizeToTray = !!enabled;
    syncTrayState();
    return minimizeToTray;
});

app.whenReady().then(() => {
    createWindow();
    syncTrayState();
});

app.on("window-all-closed", () => {
    // Only actually quit (and stop the local server) once minimize-to-
    // tray is off — otherwise "all windows closed" just means "hidden
    // to tray", and the app should keep running.
    if (!minimizeToTray) {
        if (server) server.close();
        if (process.platform !== "darwin") {
            app.quit();
        }
    }
});

app.on("before-quit", () => {
    app.isQuitting = true;
    if (server) server.close();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});
