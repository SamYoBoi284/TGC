// ===========================================
// The Glitchcore Chronicle
// js/milestones.js
// MILESTONE 4: Milestones
// ===========================================
//
// Owns the Milestones route entirely. A "special section for
// important life events" per the README: Title (required),
// Date & time (auto-filled the moment the user starts typing —
// not manually editable, this is a record of *when it was logged*),
// Description (optional), Tags (optional). Separate "milestones"
// collection via store.js, own list + search, same autosave /
// archive-not-delete philosophy as Entries and Brain Dump.

import { openCollection } from "./store.js";

const milestonesStore = openCollection("milestones");

const AUTOSAVE_DELAY_MS = 800; // matches Entries — this isn't a speed-first surface like Brain Dump

let activeMilestoneId = null; // null while composing a brand-new, unsaved milestone
let draftOccurredAt = null;   // timestamp claimed the instant a blank draft is first touched
let autosaveTimer = null;
let searchQuery = "";

export function initMilestones() {
    const root = document.getElementById("milestonesPage");
    if (!root) return;

    root.innerHTML = buildShell();
    wireListPanel();
    wireFormPanel();

    renderList();
    openBlankMilestone();
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildShell() {
    return `
        <div id="milestonesLayout">
            <aside id="milestonesListPanel">
                <div id="milestonesListHeader">
                    <input type="text" id="milestonesSearchInput" placeholder="Search milestones...">
                    <button type="button" id="milestonesNewButton" title="New milestone">+</button>
                </div>
                <div id="milestonesListScroll"></div>
            </aside>

            <section id="milestonesFormPanel">
                <div id="milestonesFormMeta">
                    <input type="text" id="milestoneTitleInput" placeholder="What happened?">
                    <span id="milestoneTimestamp"></span>
                </div>

                <textarea id="milestoneDescriptionInput" placeholder="Add a description (optional)..." rows="6"></textarea>

                <input type="text" id="milestoneTagsInput" placeholder="Tags, comma separated (optional)">

                <div id="milestonesFormFooter">
                    <span id="milestonesSaveStatus">All changes saved</span>
                    <button type="button" id="milestoneArchiveButton">Archive</button>
                </div>
            </section>
        </div>
    `;
}

// ---------------------------------------------------------------
// List panel
// ---------------------------------------------------------------

function wireListPanel() {
    document.getElementById("milestonesNewButton").addEventListener("click", openBlankMilestone);

    document.getElementById("milestonesSearchInput").addEventListener("input", e => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
    });
}

function renderList() {
    const scroll = document.getElementById("milestonesListScroll");
    if (!scroll) return;

    const milestones = milestonesStore.all()
        .filter(m => !m.archived)
        .filter(matchesSearch)
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

    if (!milestones.length) {
        scroll.innerHTML = `<p id="milestonesListEmpty">${searchQuery ? "No matching milestones." : "No milestones yet."}</p>`;
        return;
    }

    scroll.innerHTML = milestones.map(m => `
        <div class="milestoneListItem ${m.id === activeMilestoneId ? "milestoneListItemActive" : ""}" data-id="${m.id}">
            <div class="milestoneListItemTitle">${escapeHtml(m.title || "Untitled milestone")}</div>
            <div class="milestoneListItemMeta">
                <span>${formatDateTime(m.occurredAt)}</span>
                <span class="milestoneListItemTags">${(m.tags || []).slice(0, 3).join(", ")}</span>
            </div>
        </div>
    `).join("");

    scroll.querySelectorAll(".milestoneListItem").forEach(el => {
        el.addEventListener("click", () => openMilestone(el.dataset.id));
    });
}

function matchesSearch(milestone) {
    if (!searchQuery) return true;
    const haystack = [
        milestone.title || "",
        milestone.description || "",
        (milestone.tags || []).join(" ")
    ].join(" ").toLowerCase();
    return haystack.includes(searchQuery);
}

// ---------------------------------------------------------------
// Form panel
// ---------------------------------------------------------------

function wireFormPanel() {
    document.getElementById("milestoneTitleInput").addEventListener("input", handleFieldTouched);
    document.getElementById("milestoneDescriptionInput").addEventListener("input", handleFieldTouched);
    document.getElementById("milestoneTagsInput").addEventListener("input", handleFieldTouched);

    document.getElementById("milestoneArchiveButton").addEventListener("click", archiveActiveMilestone);
}

function handleFieldTouched() {
    // The date/time is a record of when this milestone was logged —
    // auto-filled the instant a blank draft is first touched, then frozen.
    if (!activeMilestoneId && !draftOccurredAt) {
        draftOccurredAt = new Date().toISOString();
        renderTimestamp(draftOccurredAt);
    }
    scheduleAutosave();
}

function openBlankMilestone() {
    activeMilestoneId = null;
    draftOccurredAt = null;
    clearTimeout(autosaveTimer);

    document.getElementById("milestoneTitleInput").value = "";
    document.getElementById("milestoneDescriptionInput").value = "";
    document.getElementById("milestoneTagsInput").value = "";
    renderTimestamp(null);

    setSaveStatus("All changes saved");
    document.getElementById("milestoneArchiveButton").disabled = true;
    renderList();
}

function openMilestone(id) {
    const milestone = milestonesStore.get(id);
    if (!milestone) return;

    activeMilestoneId = id;
    draftOccurredAt = null;
    clearTimeout(autosaveTimer);

    document.getElementById("milestoneTitleInput").value = milestone.title || "";
    document.getElementById("milestoneDescriptionInput").value = milestone.description || "";
    document.getElementById("milestoneTagsInput").value = (milestone.tags || []).join(", ");
    renderTimestamp(milestone.occurredAt);

    setSaveStatus("All changes saved");
    document.getElementById("milestoneArchiveButton").disabled = false;
    renderList();
}

function renderTimestamp(iso) {
    const el = document.getElementById("milestoneTimestamp");
    if (!el) return;
    el.textContent = iso ? formatDateTime(iso) : "Logged the moment you start typing";
}

function scheduleAutosave() {
    setSaveStatus("Saving...");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveActiveMilestone, AUTOSAVE_DELAY_MS);
}

function saveActiveMilestone() {
    const fields = collectFieldsFromForm();

    // Don't create a milestone record out of a completely empty, untouched draft.
    if (!activeMilestoneId && !fields.title && !fields.description && !fields.tags.length) {
        setSaveStatus("All changes saved");
        return;
    }

    if (activeMilestoneId) {
        milestonesStore.update(activeMilestoneId, fields);
    } else {
        const created = milestonesStore.create(fields);
        activeMilestoneId = created.id;
        document.getElementById("milestoneArchiveButton").disabled = false;
    }

    setSaveStatus("All changes saved");
    renderList();
}

function collectFieldsFromForm() {
    const tagsRaw = document.getElementById("milestoneTagsInput").value;

    return {
        title: document.getElementById("milestoneTitleInput").value.trim(),
        description: document.getElementById("milestoneDescriptionInput").value.trim(),
        tags: tagsRaw.split(",").map(t => t.trim()).filter(Boolean),
        occurredAt: activeMilestoneId
            ? milestonesStore.get(activeMilestoneId).occurredAt
            : (draftOccurredAt || new Date().toISOString())
    };
}

function archiveActiveMilestone() {
    if (!activeMilestoneId) return;
    milestonesStore.archive(activeMilestoneId);
    openBlankMilestone();
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function formatDateTime(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(iso));
}

function escapeHtml(str) {
    const tmp = document.createElement("div");
    tmp.textContent = str;
    return tmp.innerHTML;
}

function setSaveStatus(text) {
    const el = document.getElementById("milestonesSaveStatus");
    if (el) el.textContent = text;
}
