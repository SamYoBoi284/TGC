// ===========================================
// The Glitchcore Chronicle
// js/entries.js
// MILESTONE 2: Journal Entries
// ===========================================
//
// Owns the Entries route entirely: rendering the list, the open
// entry's editor panel, create/edit/archive, in-page search, and
// autosave. Talks to localStorage only through store.js.

import { openCollection } from "./store.js";
import { mountEditor } from "./editor.js";

const entriesStore = openCollection("entries");

const MOODS = [
    { key: "great", icon: "😁", label: "Great" },
    { key: "good", icon: "🙂", label: "Good" },
    { key: "neutral", icon: "😐", label: "Neutral" },
    { key: "bad", icon: "😕", label: "Bad" },
    { key: "terrible", icon: "😭", label: "Terrible" }
];

const AUTOSAVE_DELAY_MS = 800;

let editorInstance = null;
let activeEntryId = null;     // null while composing a brand-new, unsaved entry
let autosaveTimer = null;
let searchQuery = "";

export function initEntries() {
    const root = document.getElementById("entriesPage");
    if (!root) return;

    root.innerHTML = buildEntriesShell();
    wireListPanel();
    wireEditorPanel();

    renderList();
    openBlankEntry();
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildEntriesShell() {
    return `
        <div id="entriesLayout">
            <aside id="entriesListPanel">
                <div id="entriesListHeader">
                    <input type="text" id="entriesSearchInput" placeholder="Search entries...">
                    <button type="button" id="entriesNewButton" title="New entry">+</button>
                </div>
                <div id="entriesListScroll"></div>
            </aside>

            <section id="entriesEditorPanel">
                <div id="entriesEditorMeta">
                    <input type="text" id="entryTitleInput" placeholder="Untitled entry">

                    <div id="entryMetaRow">
                        <input type="date" id="entryDateInput">

                        <div id="entryMoodPicker">
                            ${MOODS.map(m => `
                                <button type="button" class="entryMoodOption" data-mood="${m.key}" title="${m.label}">${m.icon}</button>
                            `).join("")}
                        </div>
                    </div>

                    <input type="text" id="entryTagsInput" placeholder="Tags, comma separated">
                </div>

                <div id="entryEditorMount"></div>

                <div id="entriesEditorFooter">
                    <span id="entriesSaveStatus">All changes saved</span>
                    <div id="entriesEditorActions">
                        <button type="button" id="entryArchiveButton">Archive</button>
                    </div>
                </div>
            </section>
        </div>
    `;
}

// ---------------------------------------------------------------
// List panel
// ---------------------------------------------------------------

function wireListPanel() {
    document.getElementById("entriesNewButton").addEventListener("click", openBlankEntry);

    document.getElementById("entriesSearchInput").addEventListener("input", e => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
    });
}

function renderList() {
    const scroll = document.getElementById("entriesListScroll");
    if (!scroll) return;

    const entries = entriesStore.all()
        .filter(e => !e.archived)
        .filter(matchesSearch)
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    if (!entries.length) {
        scroll.innerHTML = `<p id="entriesListEmpty">${searchQuery ? "No matching entries." : "No entries yet. Start writing."}</p>`;
        return;
    }

    scroll.innerHTML = entries.map(entry => `
        <div class="entryListItem ${entry.id === activeEntryId ? "entryListItemActive" : ""}" data-id="${entry.id}">
            <div class="entryListItemTop">
                <span class="entryListItemTitle">${escapeHtml(entry.title || "Untitled entry")}</span>
                <span class="entryListItemMood">${moodIcon(entry.mood)}</span>
            </div>
            <div class="entryListItemMeta">
                <span>${formatDate(entry.date)}</span>
                <span class="entryListItemTags">${(entry.tags || []).slice(0, 3).join(", ")}</span>
            </div>
        </div>
    `).join("");

    scroll.querySelectorAll(".entryListItem").forEach(el => {
        el.addEventListener("click", () => openEntry(el.dataset.id));
    });
}

function matchesSearch(entry) {
    if (!searchQuery) return true;
    const haystack = [
        entry.title || "",
        stripHtml(entry.body || ""),
        (entry.tags || []).join(" ")
    ].join(" ").toLowerCase();
    return haystack.includes(searchQuery);
}

// ---------------------------------------------------------------
// Editor panel
// ---------------------------------------------------------------

function wireEditorPanel() {
    editorInstance = mountEditor(document.getElementById("entryEditorMount"), {
        onChange: () => scheduleAutosave()
    });

    document.getElementById("entryTitleInput").addEventListener("input", () => scheduleAutosave());
    document.getElementById("entryDateInput").addEventListener("input", () => scheduleAutosave());
    document.getElementById("entryTagsInput").addEventListener("input", () => scheduleAutosave());

    document.querySelectorAll(".entryMoodOption").forEach(btn => {
        btn.addEventListener("click", () => {
            const isSame = btn.classList.contains("entryMoodOptionActive");
            document.querySelectorAll(".entryMoodOption").forEach(b => b.classList.remove("entryMoodOptionActive"));
            if (!isSame) btn.classList.add("entryMoodOptionActive");
            scheduleAutosave();
        });
    });

    document.getElementById("entryArchiveButton").addEventListener("click", archiveActiveEntry);
}

function openBlankEntry() {
    activeEntryId = null;
    clearTimeout(autosaveTimer);

    document.getElementById("entryTitleInput").value = "";
    document.getElementById("entryDateInput").value = todayIso();
    document.getElementById("entryTagsInput").value = "";
    document.querySelectorAll(".entryMoodOption").forEach(b => b.classList.remove("entryMoodOptionActive"));
    editorInstance.setHTML("");

    setSaveStatus("All changes saved");
    document.getElementById("entryArchiveButton").disabled = true;
    renderList();
}

function openEntry(id) {
    const entry = entriesStore.get(id);
    if (!entry) return;

    activeEntryId = id;
    clearTimeout(autosaveTimer);

    document.getElementById("entryTitleInput").value = entry.title || "";
    document.getElementById("entryDateInput").value = entry.date || todayIso();
    document.getElementById("entryTagsInput").value = (entry.tags || []).join(", ");
    document.querySelectorAll(".entryMoodOption").forEach(b => {
        b.classList.toggle("entryMoodOptionActive", b.dataset.mood === entry.mood);
    });
    editorInstance.setHTML(entry.body || "");

    setSaveStatus("All changes saved");
    document.getElementById("entryArchiveButton").disabled = false;
    renderList();
}

function scheduleAutosave() {
    setSaveStatus("Saving...");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveActiveEntry, AUTOSAVE_DELAY_MS);
}

function saveActiveEntry() {
    const fields = collectFieldsFromForm();

    // Don't create an entry record out of a completely empty, untouched draft.
    if (!activeEntryId && !fields.title && !stripHtml(fields.body) && !fields.tags.length) {
        setSaveStatus("All changes saved");
        return;
    }

    if (activeEntryId) {
        entriesStore.update(activeEntryId, fields);
    } else {
        const created = entriesStore.create(fields);
        activeEntryId = created.id;
        document.getElementById("entryArchiveButton").disabled = false;
    }

    setSaveStatus("All changes saved");
    renderList();
}

function collectFieldsFromForm() {
    const moodBtn = document.querySelector(".entryMoodOption.entryMoodOptionActive");
    const tagsRaw = document.getElementById("entryTagsInput").value;

    return {
        title: document.getElementById("entryTitleInput").value.trim(),
        date: document.getElementById("entryDateInput").value || todayIso(),
        mood: moodBtn ? moodBtn.dataset.mood : null,
        tags: tagsRaw.split(",").map(t => t.trim()).filter(Boolean),
        body: editorInstance.getHTML()
    };
}

function archiveActiveEntry() {
    if (!activeEntryId) return;
    entriesStore.archive(activeEntryId);
    openBlankEntry();
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function todayIso() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function formatDate(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" })
        .format(new Date(`${iso}T00:00:00`));
}

function moodIcon(key) {
    return MOODS.find(m => m.key === key)?.icon || "";
}

function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || "";
}

function escapeHtml(str) {
    const tmp = document.createElement("div");
    tmp.textContent = str;
    return tmp.innerHTML;
}

function setSaveStatus(text) {
    const el = document.getElementById("entriesSaveStatus");
    if (el) el.textContent = text;
}
