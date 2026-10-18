// ===========================================
// The Glitchcore Chronicle
// service-worker.js
// PWA SUPPORT — APP SHELL CACHING ONLY
// ===========================================
//
// Scope of this file, deliberately narrow:
// - Cache the static app shell (index.html, manifest, css/js, icons)
//   so the installed PWA opens instantly and works offline.
// - Nothing else. It never touches Firebase/Firestore, Google
//   Sign-In, or any other cross-origin request — those are left
//   completely alone (see the origin check in the fetch handler
//   below), and localStorage is untouched since this file only ever
//   reads/writes the Cache Storage API.
// - Not loaded at all under Electron (see js/app.js's registration
//   guard) — Electron already has everything on local disk via its
//   own local HTTP server, so there's nothing for this to add there,
//   and this keeps the two environments fully independent.

// AUTH GATE UPDATE: v2 -> v3 — removed references to maskable icon
// files that never actually existed in /assets. cache.addAll() fails
// the ENTIRE install if any single listed file 404s, so this was
// silently breaking service worker install on every load (which
// means manifest.json + the real shell files were never getting
// cached either, on top of manifest.json itself not existing until
// this same update — see manifest.json, newly added).
const CACHE_NAME = "chronicle-shell-v4";

// Every file the app needs to boot to a usable shell. Deliberately
// static/explicit rather than "cache everything" — keeps this file
// simple to reason about and easy to bump (just change CACHE_NAME)
// whenever the shell's file list changes.
const APP_SHELL_FILES = [
    "./",
    "./index.html",
    "./manifest.json",

    "./css/variables.css",
    "./css/layout.css",
    "./css/components.css",
    "./css/entries.css",
    "./css/braindump.css",
    "./css/milestones.css",
    "./css/ideas.css",
    "./css/timeline.css",
    "./css/search.css",
    "./css/onthisday.css",
    "./css/settings.css",
    "./css/archive.css",
    "./css/auth.css",
    "./css/ambient-effects.css",

    "./js/authgate.js",
    "./js/app.js",
    "./js/sidebar.js",
    "./js/dock.js",
    "./js/home.js",
    "./js/entries.js",
    "./js/braindump.js",
    "./js/milestones.js",
    "./js/ideas.js",
    "./js/timeline.js",
    "./js/search.js",
    "./js/onthisday.js",
    "./js/archive.js",
    "./js/settings.js",
    "./js/store.js",
    "./js/collections.js",
    "./js/editor.js",
    "./js/firebase.js",
    "./js/syncqueue.js",
    "./js/ambient-effects.js",

    "./assets/icon-192.png",
    "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL_FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;

    // Only ever handle same-origin GET requests for the app shell.
    // Everything else — Firebase/Firestore, Google Sign-In's popup
    // and redirect flows, gstatic/googleapis SDK chunks, any POST —
    // is left completely alone by simply not calling respondWith(),
    // so it goes straight to the network exactly as if this file
    // didn't exist.
    if (request.method !== "GET") return;
    if (new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;

            return fetch(request).then((response) => {
                // Only cache successful, basic (same-origin) responses.
                if (response.ok && response.type === "basic") {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            }).catch(() => cached);
        })
    );
});
