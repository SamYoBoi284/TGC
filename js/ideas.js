// ===========================================
// The Glitchcore Chronicle
// js/ideas.js
// MILESTONE 5: Ideas
// ===========================================
//
// Owns the Ideas route entirely. Per the README: a catch-all for
// coding ideas, music ideas, random thoughts, and future plans —
// everything searchable. Structurally this follows Milestones
// (list panel + form panel, same openCollection("ideas") pattern
// via store.js) rather than Brain Dump, because Ideas needs a
// category on top of title/body/tags. The one addition over the
// Milestones shape is a category picker (reusing the Entries mood-
// picker's pill-button pattern) plus category filter chips in the
// list header, since "everything searchable" reads as "including
// by category" here.
//
// No occurredAt-freeze logic like Milestones — the README attaches
// no date/time requirement to Ideas, so it just rides on store.js's
// own createdAt/updatedAt like Entries and Brain Dump do.

import { openCollection } from "./store.js";

const ideasStore = openCollection("ideas");

const AUTOSAVE_DELAY_MS = 800; // structured form (title+category+body+tags) like Milestones, not a single-field rapid-capture surface

const CATEGORIES = [
    { key: "coding", label: "Coding", icon: "💻" },
    { key: "music", label: "Music", icon: "🎵" },
    { key: "random", label: "Random Thought", icon: "💭" },
    { key: "future", label: "Future Plan", icon: "🔮" }
];

let activeIdeaId = null; // null while composing a brand-new, unsaved idea
let autosaveTimer = null;
let searchQuery = "";
let activeFilter = "all"; // "all" or a CATEGORIES key

export function initIdeas() {
    const root = document.getElementById("ideasPage");
    if (!root) return;

    root.innerHTML = buildShell();
    wireListPanel();
    wireFormPanel();

    renderList();
    openBlankIdea();
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildShell() {
    return `
        <div id="ideasLayout">
            <aside id="ideasListPanel">
                <div id="ideasListHeader">
                    <input type="text" id="ideasSearchInput" placeholder="Search ideas...">
                    <button type="button" id="ideasNewButton" title="New idea">+</button>
                </div>
                <div id="ideasFilterRow">
                    <button type="button" class="ideaFilterChip ideaFilterChipActive" data-filter="all">All</button>
                    ${CATEGORIES.map(c => `
                        <button type="button" class="ideaFilterChip" data-filter="${c.key}">${c.icon} ${c.label}</button>
                    `).join("")}
                </div>
                <div id="ideasListScroll"></div>
            </aside>

            <section id="ideasFormPanel">
                <div id="ideasFormMeta">
                    <input type="text" id="ideaTitleInput" placeholder="What's the idea?">
                    <span id="ideaTimestamp"></span>
                </div>

                <div id="ideaCategoryPicker">
                    ${CATEGORIES.map(c => `
                        <button type="button" class="ideaCategoryOption" data-category="${c.key}" title="${c.label}">${c.icon}</button>
                    `).join("")}
                </div>

                <textarea id="ideaBodyInput" placeholder="Get it down before it slips away..." rows="8"></textarea>

                <input type="text" id="ideaTagsInput" placeholder="Tags, comma separated (optional)">

                <div id="ideasFormFooter">
                    <span id="ideasSaveStatus">All changes saved</span>
                    <button type="button" id="ideaArchiveButton">Archive</button>
                </div>
            </section>
        </div>
    `;
}

// ---------------------------------------------------------------
// List panel
// ---------------------------------------------------------------

function wireListPanel() {
    document.getElementById("ideasNewButton").addEventListener("click", openBlankIdea);

    document.getElementById("ideasSearchInput").addEventListener("input", e => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderList();
    });

    document.querySelectorAll(".ideaFilterChip").forEach(chip => {
        chip.addEventListener("click", () => {
            activeFilter = chip.dataset.filter;
            document.querySelectorAll(".ideaFilterChip").forEach(c => c.classList.remove("ideaFilterChipActive"));
            chip.classList.add("ideaFilterChipActive");
            renderList();
        });
    });
}

function renderList() {
    const scroll = document.getElementById("ideasListScroll");
    if (!scroll) return;

    const ideas = ideasStore.all()
        .filter(i => !i.archived)
        .filter(matchesFilter)
        .filter(matchesSearch)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (!ideas.length) {
        scroll.innerHTML = `<p id="ideasListEmpty">${searchQuery || activeFilter !== "all" ? "No matching ideas." : "No ideas yet."}</p>`;
        return;
    }

    scroll.innerHTML = ideas.map(i => `
        <div class="ideaListItem ${i.id === activeIdeaId ? "ideaListItemActive" : ""}" data-id="${i.id}">
            <div class="ideaListItemTitle">
                <span class="ideaListItemIcon">${categoryIcon(i.category)}</span>
                <span>${escapeHtml(i.title || "Untitled idea")}</span>
            </div>
            <div class="ideaListItemMeta">
                <span>${formatDateTime(i.updatedAt)}</span>
                <span class="ideaListItemTags">${(i.tags || []).slice(0, 3).join(", ")}</span>
            </div>
        </div>
    `).join("");

    scroll.querySelectorAll(".ideaListItem").forEach(el => {
        el.addEventListener("click", () => openIdea(el.dataset.id));
    });
}

function matchesFilter(idea) {
    return activeFilter === "all" || idea.category === activeFilter;
}

function matchesSearch(idea) {
    if (!searchQuery) return true;
    const haystack = [
        idea.title || "",
        idea.body || "",
        (idea.tags || []).join(" "),
        categoryLabel(idea.category)
    ].join(" ").toLowerCase();
    return haystack.includes(searchQuery);
}

// ---------------------------------------------------------------
// Form panel
// ---------------------------------------------------------------

function wireFormPanel() {
    document.getElementById("ideaTitleInput").addEventListener("input", scheduleAutosave);
    document.getElementById("ideaBodyInput").addEventListener("input", scheduleAutosave);
    document.getElementById("ideaTagsInput").addEventListener("input", scheduleAutosave);

    document.querySelectorAll(".ideaCategoryOption").forEach(btn => {
        btn.addEventListener("click", () => {
            const isSame = btn.classList.contains("ideaCategoryOptionActive");
            document.querySelectorAll(".ideaCategoryOption").forEach(b => b.classList.remove("ideaCategoryOptionActive"));
            if (!isSame) btn.classList.add("ideaCategoryOptionActive");
            scheduleAutosave();
        });
    });

    document.getElementById("ideaArchiveButton").addEventListener("click", archiveActiveIdea);
}

function openBlankIdea() {
    activeIdeaId = null;
    clearTimeout(autosaveTimer);

    document.getElementById("ideaTitleInput").value = "";
    document.getElementById("ideaBodyInput").value = "";
    document.getElementById("ideaTagsInput").value = "";
    document.querySelectorAll(".ideaCategoryOption").forEach(b => b.classList.remove("ideaCategoryOptionActive"));
    renderTimestamp(null);

    setSaveStatus("All changes saved");
    document.getElementById("ideaArchiveButton").disabled = true;
    renderList();
}

function openIdea(id) {
    const idea = ideasStore.get(id);
    if (!idea) return;

    activeIdeaId = id;
    clearTimeout(autosaveTimer);

    document.getElementById("ideaTitleInput").value = idea.title || "";
    document.getElementById("ideaBodyInput").value = idea.body || "";
    document.getElementById("ideaTagsInput").value = (idea.tags || []).join(", ");
    document.querySelectorAll(".ideaCategoryOption").forEach(b => {
        b.classList.toggle("ideaCategoryOptionActive", b.dataset.category === idea.category);
    });
    renderTimestamp(idea.updatedAt);

    setSaveStatus("All changes saved");
    document.getElementById("ideaArchiveButton").disabled = false;
    renderList();
}

function renderTimestamp(iso) {
    const el = document.getElementById("ideaTimestamp");
    if (!el) return;
    el.textContent = iso ? formatDateTime(iso) : "";
}

function scheduleAutosave() {
    setSaveStatus("Saving...");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveActiveIdea, AUTOSAVE_DELAY_MS);
}

function saveActiveIdea() {
    const fields = collectFieldsFromForm();

    // Don't create an idea record out of a completely empty, untouched draft.
    if (!activeIdeaId && !fields.title && !fields.body && !fields.tags.length && !fields.category) {
        setSaveStatus("All changes saved");
        return;
    }

    if (activeIdeaId) {
        ideasStore.update(activeIdeaId, fields);
    } else {
        const created = ideasStore.create(fields);
        activeIdeaId = created.id;
        document.getElementById("ideaArchiveButton").disabled = false;
    }

    renderTimestamp(ideasStore.get(activeIdeaId).updatedAt);
    setSaveStatus("All changes saved");
    renderList();
}

function collectFieldsFromForm() {
    const tagsRaw = document.getElementById("ideaTagsInput").value;
    const activeCategoryBtn = document.querySelector(".ideaCategoryOption.ideaCategoryOptionActive");

    return {
        title: document.getElementById("ideaTitleInput").value.trim(),
        body: document.getElementById("ideaBodyInput").value.trim(),
        category: activeCategoryBtn ? activeCategoryBtn.dataset.category : null,
        tags: tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
    };
}

function archiveActiveIdea() {
    if (!activeIdeaId) return;
    ideasStore.archive(activeIdeaId);
    openBlankIdea();
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function categoryIcon(key) {
    return CATEGORIES.find(c => c.key === key)?.icon || "•";
}

function categoryLabel(key) {
    return CATEGORIES.find(c => c.key === key)?.label || "";
}

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
    const el = document.getElementById("ideasSaveStatus");
    if (el) el.textContent = text;
}
