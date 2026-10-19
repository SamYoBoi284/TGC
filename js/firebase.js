// ===========================================
// The Glitchcore Chronicle
// js/firebase.js
// MILESTONE 12: Firebase core (isolated, opt-in, off by default)
// ===========================================
//
// This module is never imported by app.js at startup. It is only
// dynamically import()'d by settings.js when the user flips "Cloud
// backup" on. If cloud sync is off (the default), the Firebase SDK
// is never fetched and never touches the page — offline-first stays
// the real default, not just in spirit.
//
// Scope for this milestone: connect + read/write access to Firestore
// only. No auth yet (per project notes — Google Sign-In lands once
// testing wraps up), so this uses anonymous Firestore access. That is
// a known, explicit tradeoff: anyone with the config below could
// technically write to this project until Firestore security rules
// and real auth are added. Flagging it here again since it's a
// decision that outlives this file.
//
// Milestone 13 (sync queue + manual backup) builds on top of the
// small API this file exports — it doesn't touch this file's guts.

const FIREBASE_SDK_VERSION = "10.14.1";
const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

// Your project's config, pasted in during Milestone 12 setup. This is
// the public client config Firebase expects to ship in the browser
// (it identifies the project, it isn't a secret credential) — but it
// still lives in settings.js's local storage, not hardcoded here, so
// swapping projects later doesn't mean editing source.
export const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAAiupT5YHhVkKZqdl6doImv0AkQa9msS4",
    authDomain: "the-glitchcore-chronicle.firebaseapp.com",
    projectId: "the-glitchcore-chronicle",
    storageBucket: "the-glitchcore-chronicle.firebasestorage.app",
    messagingSenderId: "647067989061",
    appId: "1:647067989061:web:22458c451fccf377bd1f2c"
};

let sdkModules = null; // { initializeApp, getFirestore, ... } once loaded
let firestoreDb = null;
let currentApp = null;
let authInstance = null;
let authModules = null; // separate lazy chunk, only loaded if sign-in is used
let currentUser = null;
const authListeners = [];

// ===========================================
// LAZY SDK LOAD
// ===========================================

async function loadSdk() {
    if (sdkModules) return sdkModules;

    const [appMod, firestoreMod] = await Promise.all([
        import(/* webpackIgnore: true */ `${FIREBASE_CDN}/firebase-app.js`),
        import(/* webpackIgnore: true */ `${FIREBASE_CDN}/firebase-firestore.js`)
    ]);

    sdkModules = { ...appMod, ...firestoreMod };
    return sdkModules;
}

// ===========================================
// CONNECTION
// ===========================================

// Initializes Firebase with the given config (falls back to
// DEFAULT_FIREBASE_CONFIG) and returns { ok, error }. Safe to call
// more than once — later calls are no-ops if already connected with
// the same config.
export async function connectFirebase(config = DEFAULT_FIREBASE_CONFIG) {
    try {
        const sdk = await loadSdk();

        if (!currentApp) {
            currentApp = sdk.initializeApp(config);
            firestoreDb = sdk.getFirestore(currentApp);
        }

        return { ok: true, error: null };
    } catch (err) {
        console.warn("Firebase connect failed:", err);
        return { ok: false, error: err?.message || "Could not connect to Firebase." };
    }
}

export function isConnected() {
    return !!currentApp;
}

export function getDb() {
    return firestoreDb;
}

// Lightweight connectivity check for a "Test connection" button in
// Settings — writes and immediately reads back a tiny heartbeat doc.
// Requires Firestore rules to allow it (open rules during testing,
// per project notes).
export async function testConnection(config = DEFAULT_FIREBASE_CONFIG) {
    const connectResult = await connectFirebase(config);
    if (!connectResult.ok) return connectResult;

    if (!currentUser) {
        return { ok: false, error: "Sign in with Google first — Firestore rules require an authenticated user." };
    }

    try {
        const sdk = sdkModules;
        const ref = sdk.doc(firestoreDb, "users", currentUser.uid, "_chronicleMeta", "heartbeat");
        await sdk.setDoc(ref, { lastPingAt: new Date().toISOString() });
        const snap = await sdk.getDoc(ref);

        if (!snap.exists()) {
            return { ok: false, error: "Wrote to Firestore but couldn't read it back." };
        }
        return { ok: true, error: null };
    } catch (err) {
        console.warn("Firebase test connection failed:", err);
        return { ok: false, error: err?.message || "Connected, but the test read/write failed — check Firestore rules." };
    }
}

// ===========================================
// GENERIC DOCUMENT ACCESS
// ===========================================
// Deliberately generic and small — Milestone 13's sync queue is the
// thing that decides what gets written when, this file just knows
// how to talk to Firestore.

export async function writeDoc(collectionName, docId, data) {
    if (!firestoreDb) throw new Error("Firebase is not connected.");
    const sdk = sdkModules;
    const ref = sdk.doc(firestoreDb, collectionName, docId);
    await sdk.setDoc(ref, data, { merge: true });
}

export async function readDoc(collectionName, docId) {
    if (!firestoreDb) throw new Error("Firebase is not connected.");
    const sdk = sdkModules;
    const ref = sdk.doc(firestoreDb, collectionName, docId);
    const snap = await sdk.getDoc(ref);
    return snap.exists() ? snap.data() : null;
}

// Reads every document in a collection — used to list backup
// snapshots (see syncqueue.js's listSnapshots/backupNow/restoreSnapshot).
export async function listDocs(collectionPath) {
    if (!firestoreDb) throw new Error("Firebase is not connected.");
    const sdk = sdkModules;
    const colRef = sdk.collection(firestoreDb, collectionPath);
    const snap = await sdk.getDocs(colRef);
    const out = [];
    snap.forEach(docSnap => out.push({ id: docSnap.id, data: docSnap.data() }));
    return out;
}

// ===========================================
// GOOGLE SIGN-IN (added post-M13)
// ===========================================
// AUTH GATE UPDATE: sign-in is now mandatory to use the app at all
// (see js/authgate.js, which is the new module entry point and calls
// restoreAuthSession()/onAuthChange() before anything in app.js
// boots). This file's functions themselves are unchanged in shape —
// authgate.js just always calls them now instead of only doing so
// when Cloud Backup was toggled on. Cloud Backup (syncqueue.js) is
// still its own separate opt-in on top of a now-required sign-in.
//
// Only loaded if signInWithGoogle() is actually called — the auth
// SDK chunk is separate from app/firestore so users who never touch
// Sign In don't pay for it either. Uses signInWithPopup. Note for
// Electron: popups work in the BrowserWindow as long as
// `authDomain` (glitchcore-chronicle.firebaseapp.com) is reachable
// and popup windows aren't blocked by webPreferences — main.js's
// setWindowOpenHandler explicitly allows popups to accounts.google.com
// and the authDomain for this reason. If the popup ever gets silently
// swallowed anyway, switch this to signInWithRedirect instead (same
// call shape, ask if that's needed).

async function loadAuthSdk() {
    if (authModules) return authModules;
    authModules = await import(/* webpackIgnore: true */ `${FIREBASE_CDN}/firebase-auth.js`);
    return authModules;
}

// Wires up Firebase's own onAuthStateChanged listener exactly once.
// This is what makes sign-in survive a page reload: Firebase persists
// the session itself (IndexedDB, same-origin), but nothing in this
// file ever checked it before — currentUser was only ever set once,
// directly from signInWithGoogle()'s popup result, so any reload
// (e.g. the one restoreFromCloud() below triggers) wiped it back to
// null even though the underlying Firebase session was still valid.
let authListenerAttached = false;

async function ensureAuthListening(config) {
    await connectFirebase(config);
    const auth = await loadAuthSdk();
    if (!authInstance) {
        authInstance = auth.getAuth(currentApp);

        // Explicit browser-local (IndexedDB) persistence. This is
        // already the SDK's default in a normal browser tab, but we
        // set it explicitly here since Electron's BrowserWindow is
        // its own separate profile/storage partition per app — being
        // explicit means the login gate's "stay signed in across
        // relaunches" behavior doesn't depend on an implicit default
        // that could change between SDK versions or environments.
        try {
            await auth.setPersistence(authInstance, auth.browserLocalPersistence);
        } catch (err) {
            console.warn("Could not set explicit auth persistence:", err);
        }
    }

    if (authListenerAttached) return;
    authListenerAttached = true;

    return new Promise(resolve => {
        let resolved = false;
        auth.onAuthStateChanged(authInstance, (user) => {
            currentUser = user;
            authListeners.forEach(fn => fn(currentUser));
            if (!resolved) {
                resolved = true;
                resolve(user);
            }
        });
    });
}

// Called on startup (whenever Cloud Backup is on) so a previously
// signed-in session is picked back up automatically instead of
// silently looking "signed out" until the user signs in again.
let lastRedirectError = null;

export async function restoreAuthSession(config = DEFAULT_FIREBASE_CONFIG) {
    lastRedirectError = null;
    try {
        const result = await ensureAuthListening(config);

        // If the user just came back from a signInWithRedirect() round
        // trip (Android/mobile path, see shouldUseRedirectFlow() below),
        // pick up the result here. onAuthStateChanged above already
        // sets currentUser on success — this call's real job is
        // surfacing an error if the redirect itself failed (wrong
        // authorized domain, blocked third-party cookies, user closed
        // the account picker, etc.), which previously just got
        // console.warn'd and silently looked like "stayed logged out."
        try {
            const auth = authModules;
            if (auth?.getRedirectResult) {
                await auth.getRedirectResult(authInstance);
            }
        } catch (err) {
            console.warn("Redirect sign-in failed:", err);
            lastRedirectError = err?.code
                ? `${err.message || "Sign-in failed."} (${err.code})`
                : (err?.message || "Sign-in failed.");
        }

        return result;
    } catch (err) {
        console.warn("Could not restore auth session:", err);
        return null;
    }
}

// authgate.js checks this right after restoreAuthSession() resolves —
// lets it show the actual failure reason instead of just quietly
// re-showing the login button with no explanation.
export function getLastRedirectError() {
    return lastRedirectError;
}

// Installed/standalone PWAs (Android "Add to Home Screen") run in
// their own restricted browsing context where window.open-based
// popups are frequently blocked or behave inconsistently — a known
// Firebase Auth limitation, not a bug in this app. Mobile Chrome even
// in a normal (non-installed) tab has the same problem often enough
// that Google's own guidance is to prefer redirect on mobile
// generally, not just once something is confirmed standalone — so
// this checks both, rather than relying only on display-mode (which
// depends on manifest.json being valid and the app actually having
// been installed, and is false right up until that happens).
function isStandalonePwa() {
    const mediaStandalone = window.matchMedia?.("(display-mode: standalone)").matches;
    const iosStandalone = window.navigator?.standalone === true;
    return !!(mediaStandalone || iosStandalone);
}

function isMobileBrowser() {
    return /Android|iPhone|iPad|iPod/i.test(window.navigator?.userAgent || "");
}

function shouldUseRedirectFlow() {
    return isStandalonePwa() || isMobileBrowser();
}

export async function signInWithGoogle(config = DEFAULT_FIREBASE_CONFIG) {
    try {
        await ensureAuthListening(config);
        const auth = authModules;

        // Android uses Credential Manager for the account picker, then
        // exchanges the Google ID token through the existing Firebase SDK.
        if (window.TGCNativeAuth && typeof window.TGCNativeAuth.signIn === "function") {
            const idToken = await new Promise((resolve, reject) => {
                let settled = false;
                const timeout = window.setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    window.__tgcNativeAuthResult = null;
                    reject(new Error("Google sign-in timed out. Please try again."));
                }, 120000);

                window.__tgcNativeAuthResult = (token, error) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeout);
                    window.__tgcNativeAuthResult = null;
                    if (token) resolve(token);
                    else reject(new Error(error || "Google sign-in was cancelled or failed."));
                };

                try {
                    window.TGCNativeAuth.signIn();
                } catch (err) {
                    settled = true;
                    window.clearTimeout(timeout);
                    window.__tgcNativeAuthResult = null;
                    reject(err);
                }
            });

            const credential = auth.GoogleAuthProvider.credential(idToken);
            const result = await auth.signInWithCredential(authInstance, credential);
            currentUser = result.user;
            authListeners.forEach(fn => fn(currentUser));
            return {
                ok: true,
                user: { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName },
                error: null
            };
        }

        // Existing browser and Electron sign-in remains unchanged.
        const provider = new auth.GoogleAuthProvider();
        try {
            const result = await auth.signInWithPopup(authInstance, provider);
            currentUser = result.user;
            authListeners.forEach(fn => fn(currentUser));
            return { ok: true, user: { uid: currentUser.uid, email: currentUser.email, displayName: currentUser.displayName }, error: null };
        } catch (popupErr) {
            const blockedCodes = ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"];
            if (shouldUseRedirectFlow() && blockedCodes.includes(popupErr?.code)) {
                await auth.signInWithRedirect(authInstance, provider);
                return { ok: true, user: null, redirecting: true, error: null };
            }
            throw popupErr;
        }
    } catch (err) {
        console.warn("Google sign-in failed:", err);
        return { ok: false, user: null, error: err?.message || "Sign-in failed." };
    }
}
export async function signOutUser() {
    if (!authInstance) return { ok: true };
    try {
        const auth = authModules;
        await auth.signOut(authInstance);
        currentUser = null;
        authListeners.forEach(fn => fn(null));
        return { ok: true };
    } catch (err) {
        console.warn("Sign-out failed:", err);
        return { ok: false, error: err?.message };
    }
}

export function getCurrentUser() {
    return currentUser;
}

// Fires immediately with current state, then again on every change.
export function onAuthChange(callback) {
    authListeners.push(callback);
    callback(currentUser);
}