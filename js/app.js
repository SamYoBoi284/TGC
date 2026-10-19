// ===========================================
// The Glitchcore Chronicle
// js/app.js — renderer entry point
// MILESTONE 1: Foundation
// ===========================================
//
// This file only bootstraps. It doesn't contain feature logic — each
// module owns its own DOM section and is initialized here in one
// place so future milestones just add one more import + init call.
//
// AUTH GATE UPDATE: this used to run itself on DOMContentLoaded.
// Now js/authgate.js is the actual <script> entry point (see
// index.html) — it decides whether a signed-in user exists, shows
// the login screen if not, and only calls bootApp() below once
// Firebase confirms an authenticated user. Nothing else in this
// file changed — the DOMContentLoaded auto-run just became an
// exported function that something else calls.

import { initSidebar } from "./sidebar.js";
import { initDock } from "./dock.js";
import { initHome } from "./home.js";
import { initEntries } from "./entries.js";
import { initBrainDump } from "./braindump.js";
import { initMilestones } from "./milestones.js";
import { initIdeas } from "./ideas.js";
import { initTimeline } from "./timeline.js";
import { initSearch } from "./search.js";
import { initOnThisDay } from "./onthisday.js";
import { initArchive } from "./archive.js";
import { initSettings } from "./settings.js";
import { initMigrationUI } from "./migration.js";
import { initAmbientEffects } from "./ambient-effects.js";

let booted = false;

// Called once, by js/authgate.js, after an authenticated user is
// confirmed. Guarded against double-boot in case something calls it
// twice (e.g. a stray auth-state re-fire).
export function bootApp() {
    if (booted) return;
    booted = true;

    // Storage warnings surface in the shell instead of silently leaving a
    // save operation stuck or making damaged data look like an empty archive.
    window.addEventListener("chronicle:storage-error", event => {
        const status = document.getElementById("footerStatusText");
        if (status) {
            status.textContent = event.detail?.message || "Local data needs attention.";
            status.dataset.tone = "error";
        }
    });
    window.addEventListener("chronicle:storage-recovered", event => {
        const status = document.getElementById("footerStatusText");
        if (status) {
            status.textContent = event.detail?.message || "Local data recovered.";
            status.dataset.tone = "success";
        }
    });

    initSidebar();
    initDock();
    initHome();
    initEntries();
    initBrainDump();
    initMilestones();
    initIdeas();
    initTimeline();
    initSearch();
    initOnThisDay();
    initArchive();
    initSettings();
    initMigrationUI();
    initAmbientEffects();
}

// ===========================================
// PWA: SERVICE WORKER REGISTRATION
// ===========================================
// App-shell caching only (see service-worker.js) — installable on
// Android via Chrome/Firebase Hosting. Skipped entirely under
// Electron: window.chronicle only exists there (exposed by
// preload.js), and Electron already serves everything from local
// disk via its own local HTTP server, so there's nothing for a
// service worker to add — this keeps the two environments fully
// independent, per the "don't interfere with Electron" requirement.
//
// This runs regardless of auth state (it just caches static files
// for instant/offline loads — the login screen itself is part of
// the shell it caches) so it's exported separately from bootApp()
// and called unconditionally by authgate.js.
export function registerServiceWorker() {
    if ("serviceWorker" in navigator && !window.chronicle) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("./service-worker.js")
                .catch((err) => console.warn("Service worker registration failed:", err));
        });
    }
}
