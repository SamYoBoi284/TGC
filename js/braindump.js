// ===========================================
// The Glitchcore Chronicle
// js/braindump.js
// MILESTONE 3: Brain Dump
// ===========================================
//
// Owns the Brain Dump route entirely. Deliberately simpler than
// Entries: no title, no mood, no tags, no rich editor — just a fast
// plain-text capture surface. Talks to localStorage only through
// store.js, in its own "braindump" collection (kept separate from
// "entries" per the README).

import { openCollection } from "./store.js";

const dumpsStore = openCollection("braindump");

const AUTOSAVE_DELAY_MS = 500; // shorter than Entries — this surface is meant to feel instant

let activeDumpId = null; // null while composing a brand-new, unsaved dump
let autosaveTimer = null;
let searchQuery = "";

export function initBrainDump() {
    const root = document.getElementById("braindumpPage");
    if (!root) return;

    root.innerHTML = buildShell();
    wireCaptureBox();
    wireListPanel();

    renderList();
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildShell() {
    return `
        <div id="dumpLayout">
            <section id="dumpCapturePanel">
                <textarea id="dumpCaptureInput" placeholder="Just type..." rows="6"></textarea>
                <div id="dumpCaptureFooter">
                    <span id="dumpSaveStatus">All changes saved</span>
                    <button type="button" id="dumpNewButton" title="Start a fresh dump">New</button>
                </div>
            </section>

            <section id="dumpListPanel">
                <div id="dumpListHeader">
                    <input type="text" id="dumpSearchInput" placeholder="Search brain dump...">
                </div>
                <div id="dumpListScroll"></div>
            </section>
        </div>
    `;
}

// ---------------------------------------------------------------
// Capture box (create + edit the active dump)
// ---------------------------------------------------------------

function wireCaptureBox() {
    const input = document.getElementById("dumpCaptureInput");
    const newButton = document.getElementById("dumpNewButton");

    input.addEventListener("input", () => {
        scheduleAutosave(input.value);
    });

    newButton.addEventListener("click", () => {
        openBlankDump();
        input.focus();
    });

    openBlankDump();
}

function scheduleAutosave(value) {
    setSaveStatus("saving");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        persist(value);
    }, AUTOSAVE_DELAY_MS);
}

function persist(value) {
    const trimmed = value.trim();

    if (!activeDumpId) {
        // A blank, untouched dump never gets written to storage —
        // same "don't litter storage" rule Entries follows.
        if (!trimmed) {
            setSaveStatus("saved");
            return;
        }
        const record = dumpsStore.create({ body: value });
        activeDumpId = record.id;
        renderList();
        setSaveStatus("saved");
        return;
    }

    if (!trimmed) {
        // Emptied out an existing dump — archive it instead of
        // leaving a hollow record behind (still recoverable, nothing
        // is ever permanently deleted).
        dumpsStore.archive(activeDumpId);
        activeDumpId = null;
        renderList();
        setSaveStatus("saved");
        return;
    }

    dumpsStore.update(activeDumpId, { body: value });
    renderList();
    setSaveStatus("saved");
}

function setSaveStatus(state) {
    const statusEl = document.getElementById("dumpSaveStatus");
    if (!statusEl) return;
    statusEl.textContent = state === "saving" ? "Saving..." : "All changes saved";
}

function openBlankDump() {
    clearTimeout(autosaveTimer);
    activeDumpId = null;
    const input = document.getElementById("dumpCaptureInput");
    if (input) input.value = "";
    setSaveStatus("saved");
    highlightActiveInList();
}

function openDump(id) {
    const record = dumpsStore.get(id);
    if (!record) return;

    clearTimeout(autosaveTimer);
    activeDumpId = id;
    const input = document.getElementById("dumpCaptureInput");
    if (input) input.value = record.body || "";
    setSaveStatus("saved");
    highlightActiveInList();
}

// ---------------------------------------------------------------
// List panel + search
// ---------------------------------------------------------------

function wireListPanel() {
    const searchInput = document.getElementById("dumpSearchInput");
    searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        renderList();
    });
}

function renderList() {
    const listScroll = document.getElementById("dumpListScroll");
    if (!listScroll) return;

    const dumps = dumpsStore.all()
        .filter(d => !d.archived)
        .filter(d => !searchQuery || (d.body || "").toLowerCase().includes(searchQuery))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (dumps.length === 0) {
        listScroll.innerHTML = `<p id="dumpListEmpty">${searchQuery ? "No matches." : "Nothing dumped yet."}</p>`;
        return;
    }

    listScroll.innerHTML = dumps.map(d => `
        <div class="dumpListItem" data-id="${d.id}">
            <p class="dumpListItemPreview">${escapeHtml(previewOf(d.body))}</p>
            <span class="dumpListItemMeta">${formatTimestamp(d.updatedAt)}</span>
        </div>
    `).join("");

    listScroll.querySelectorAll(".dumpListItem").forEach(item => {
        item.addEventListener("click", () => {
            openDump(item.dataset.id);
        });
    });

    highlightActiveInList();
}

function highlightActiveInList() {
    document.querySelectorAll(".dumpListItem").forEach(item => {
        item.classList.toggle("dumpListItemActive", item.dataset.id === activeDumpId);
    });
}

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------

function previewOf(body) {
    const flat = (body || "").replace(/\s+/g, " ").trim();
    return flat.length > 120 ? `${flat.slice(0, 120)}…` : (flat || "(empty)");
}

function formatTimestamp(iso) {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(iso));
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
