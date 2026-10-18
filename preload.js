// ===========================================
// The Glitchcore Chronicle
// preload.js
// MILESTONE 1: Foundation
// ===========================================
//
// Nothing exposed yet — Milestone 1 has no filesystem, storage bridge,
// or IPC needs (localStorage in the renderer is enough for now).
//
// This file exists so future milestones (e.g. file attachments, local
// AI, encryption) have a place to safely expose main-process
// capabilities via contextBridge, without ever turning on
// nodeIntegration in the renderer.

const { contextBridge, ipcRenderer, webFrame } = require("electron");

// ===========================================
// NATIVE DIALOG FOCUS-LOSS WORKAROUND
// ===========================================
// Known Electron/Chromium bug (electron/electron#19977, #40212): after
// a native alert()/confirm()/prompt() closes on Windows, keyboard
// input stops reaching text inputs/textareas until the window loses
// and regains OS focus (e.g. Alt+Tab) — otherwise it's stuck until you
// quit and relaunch. Fixed here by wrapping the three dialog functions
// in the page's own (main-world) context — contextIsolation keeps
// preload's `window` separate from the page's, so the wrapping has to
// happen via webFrame.executeJavaScript rather than assigning
// window.alert directly in this file. This runs before any of the
// app's own scripts, so every existing alert()/confirm()/prompt() call
// site picks it up automatically — nothing else needs to change.
webFrame.executeJavaScript(`
    (function () {
        const originalAlert = window.alert.bind(window);
        const originalConfirm = window.confirm.bind(window);
        const originalPrompt = window.prompt.bind(window);

        window.alert = function (...args) {
            const result = originalAlert(...args);
            window.chronicle && window.chronicle.restoreFocusAfterDialog();
            return result;
        };
        window.confirm = function (...args) {
            const result = originalConfirm(...args);
            window.chronicle && window.chronicle.restoreFocusAfterDialog();
            return result;
        };
        window.prompt = function (...args) {
            const result = originalPrompt(...args);
            window.chronicle && window.chronicle.restoreFocusAfterDialog();
            return result;
        };
    })();
`);

contextBridge.exposeInMainWorld("chronicle", {
    // Electron/Chromium focus-loss workaround (see wrapper above):
    // tells main to do a corrective blur->focus cycle, but ONLY right
    // after a native alert()/confirm()/prompt() actually closes,
    // instead of on every generic window focus event (which would
    // cause flicker on a normal Alt+Tab-back).
    restoreFocusAfterDialog: () => ipcRenderer.send("chronicle:restore-focus-after-dialog"),

    // Settings feature: General > "Minimize to tray". Tells main.js
    // whether minimizing/closing the window should hide it to the
    // tray (app keeps running in the background) or behave like a
    // normal window. Called once at startup with the saved setting,
    // and again whenever the toggle changes.
    setMinimizeToTray: (enabled) => ipcRenderer.invoke("chronicle:set-minimize-to-tray", enabled)
});
