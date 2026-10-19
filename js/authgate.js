// ===========================================
// The Glitchcore Chronicle
// js/authgate.js — authentication gate
// AUTH GATE UPDATE
// ===========================================
//
// This is now the actual <script type="module"> entry point loaded
// by index.html (it used to be js/app.js directly). Its only job:
//
//   1. Show a "checking session…" state immediately (no flash of
//      either the login screen or the app).
//   2. Ask Firebase whether a user is already signed in
//      (restoreAuthSession — this works the same way on Android PWA
//      and Electron, since both are just a Chromium browsing context
//      to Firebase Auth; the SDK's IndexedDB-backed persistence is
//      what survives the reload/relaunch).
//   3. If yes → hide the login screen, show #appShell, boot the real
//      app via app.js's bootApp().
//   4. If no → show the login screen and wait for the "Sign in with
//      Google" button.
//   5. Keep listening for auth changes for the rest of the session —
//      if the user signs out later (e.g. the Settings > Sign out
//      button), the gate re-locks and the login screen comes back,
//      since nothing else in the app is allowed to be usable without
//      an authenticated user.
//
// No anonymous access, no bypass: every route lives inside
// #appShell, and #appShell stays `hidden` until step 3 above fires.
// This module doesn't change localStorage, Firestore sync, or any
// existing feature module — it just decides *when* app.js's boot
// runs.

import { restoreAuthSession, onAuthChange, signInWithGoogle, getLastRedirectError } from "./firebase.js";
import { bootApp, registerServiceWorker } from "./app.js";
import { setStorageProfile } from "./store.js";

const authScreen = document.getElementById("authGateScreen");
const appShell = document.getElementById("appShell");
const signInBtn = document.getElementById("authGateSignInBtn");
const guestBtn = document.getElementById("authGateGuestBtn");
const ACCESS_MODE_KEY = "chronicle.accessMode";
const getAccessMode = () => localStorage.getItem(ACCESS_MODE_KEY) === "guest" ? "guest" : "account";
const statusEl = document.getElementById("authGateStatusText");
const spinnerEl = document.getElementById("authGateSpinner");

let appBooted = false;
let appMode = null;
let signingIn = false;

function setStatus(text, tone = "normal") {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.dataset.tone = tone;
}

function showCheckingState() {
    if (spinnerEl) spinnerEl.hidden = false;
    if (signInBtn) signInBtn.hidden = true;
    if (guestBtn) guestBtn.hidden = true;
    setStatus("Checking your session…");
}

function showLoginState() {
    if (getAccessMode() === "guest") { showApp("guest"); return; }
    if (spinnerEl) spinnerEl.hidden = true;
    if (signInBtn) {
        signInBtn.hidden = false;
        signInBtn.disabled = false;
    }
    if (guestBtn) { guestBtn.hidden = false; guestBtn.disabled = false; }
    setStatus("");
    authScreen?.removeAttribute("hidden");
    appShell?.setAttribute("hidden", "");
}

function showApp(mode = "account") {
    if (appBooted) { if (appMode !== mode) window.location.reload(); return; }
    appMode = mode;
    setStorageProfile(mode);
    authScreen?.setAttribute("hidden", "");
    appShell?.removeAttribute("hidden");
    appBooted = true;
    bootApp();
}

// PWA shell caching is independent of auth state — it just makes
// static files (including this login screen) load instantly/offline.
registerServiceWorker();

showCheckingState();

signInBtn?.addEventListener("click", async () => {
    if (signingIn) return;
    signingIn = true;
    localStorage.setItem(ACCESS_MODE_KEY, "account");
    signInBtn.disabled = true;
    setStatus("Opening Google sign-in…");

    const result = await signInWithGoogle();

    if (result.ok && result.redirecting) {
        // Installed/standalone PWA path: the page is about to navigate
        // away to accounts.google.com. Leave the button disabled and
        // the status message up rather than resetting state, since
        // this tab's JS is done running momentarily anyway.
        setStatus("Redirecting to Google…");
        return;
    }

    signingIn = false;
    if (!result.ok) {
        signInBtn.disabled = false;
        setStatus(result.error || "Sign-in failed. Try again.", "error");
    }
    // On success (popup path), onAuthChange (wired below) fires and
    // shows the app — no need to duplicate that here.
});

// Fires immediately with whatever's known right now, then again on
// every future change (sign-in, sign-out, session expiry). This is
// the single source of truth the whole app defers to: as long as
// this callback sees `null`, the login screen stays up no matter
// what else is going on in the page.
guestBtn?.addEventListener("click", () => {
    localStorage.setItem(ACCESS_MODE_KEY, "guest");
    showApp("guest");
});

// Guest mode stays local-only and opens immediately without loading Firebase,
// so the chronicle remains available when offline.
if (getAccessMode() === "guest") {
    showApp("guest");
} else {
    showCheckingState();
    onAuthChange((user) => {
        if (getAccessMode() === "guest") return;
        if (user) showApp("account");
        else if (appBooted && appMode !== "guest") window.location.reload();
        else showLoginState();
    });
    restoreAuthSession()
        .then(() => {
            const redirectError = getLastRedirectError();
            if (redirectError && !appBooted) { showLoginState(); setStatus(redirectError, "error"); }
        })
        .catch((err) => {
            console.warn("Auth restore failed:", err);
            showLoginState();
            setStatus("Couldn't reach the sign-in service. Check your connection and try again.", "error");
        });
}
