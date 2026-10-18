// ===========================================
// The Glitchcore Chronicle
// js/search.js
// MILESTONE 7: Search
// ===========================================
//
// Owns the Search route entirely. Per the README: one global search
// across Entries, Brain Dump, Milestones, and Ideas (title/body/tags
// all count as matchable text), results grouped by category.
//
// Read-only, same as Timeline — Search is a discovery surface, not an
// editing one. It re-reads all four collections through the shared
// js/collections.js helper (the same one Timeline now uses) rather
// than opening its own collections or duplicating the read.
//
// No debounce on the input: none of the existing search boxes
// (Entries/Brain Dump/Milestones/Ideas) debounce theirs either, and
// these collections are small enough that re-filtering on every
// keystroke stays instant.

import { getAllItems, COLLECTION_TYPES } from "./collections.js";

const MOOD_ICONS = { great: "😁", good: "🙂", neutral: "😐", bad: "😕", terrible: "😭" };
const CATEGORY_LABELS = { coding: "Coding", music: "Music", random: "Random Thought", future: "Future Plan" };

let query = "";

export function initSearch() {
    const root = document.getElementById("searchPage");
    if (!root) return;

    root.innerHTML = buildShell();
    wireInput();
    renderResults();
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildShell() {
    return `
        <div id="searchLayout">
            <div id="searchHeader">
                <input type="text" id="searchPageInput" placeholder="Search entries, brain dump, milestones, ideas, and tags...">
            </div>
            <div id="searchResultsScroll"></div>
        </div>
    `;
}

function wireInput() {
    document.getElementById("searchPageInput").addEventListener("input", e => {
        query = e.target.value.trim().toLowerCase();
        renderResults();
    });
}

// ---------------------------------------------------------------
// Results
// ---------------------------------------------------------------

function renderResults() {
    const scroll = document.getElementById("searchResultsScroll");
    if (!scroll) return;

    if (!query) {
        scroll.innerHTML = `
            <div id="searchEmptyState">
                <p>Start typing to search your chronicle.</p>
            </div>
        `;
        return;
    }

    const matches = getAllItems().filter(matchesQuery);

    if (!matches.length) {
        scroll.innerHTML = `
            <div id="searchEmptyState">
                <p>No matches for "${escapeHtml(query)}".</p>
            </div>
        `;
        return;
    }

    const grouped = COLLECTION_TYPES
        .map(({ type, label }) => ({
            type,
            label,
            items: matches
                .filter(m => m.type === type)
                .sort((a, b) => new Date(b.record.updatedAt) - new Date(a.record.updatedAt))
        }))
        .filter(group => group.items.length);

    scroll.innerHTML = `
        <p id="searchResultsCount">${matches.length} result${matches.length === 1 ? "" : "s"} for "${escapeHtml(query)}"</p>
        ${grouped.map(renderGroup).join("")}
    `;
}

function matchesQuery(item) {
    const r = item.record;
    const haystack = [
        r.title || "",
        stripHtml(r.body || ""),
        r.description || "",
        (r.tags || []).join(" "),
        item.type === "ideas" ? (CATEGORY_LABELS[r.category] || "") : ""
    ].join(" ").toLowerCase();
    return haystack.includes(query);
}

function renderGroup(group) {
    return `
        <div class="searchResultGroup">
            <h3 class="searchResultGroupTitle">${escapeHtml(group.label)} <span class="searchResultGroupCount">${group.items.length}</span></h3>
            <div class="searchResultGroupItems">
                ${group.items.map(renderResultCard).join("")}
            </div>
        </div>
    `;
}

function renderResultCard(item) {
    const r = item.record;

    if (item.type === "entries") {
        return card(r.title || "Untitled entry", stripHtml(r.body), r.tags, r.mood ? MOOD_ICONS[r.mood] : null);
    }
    if (item.type === "braindump") {
        return card(null, r.body, []);
    }
    if (item.type === "milestones") {
        return card(r.title || "Untitled milestone", r.description, r.tags);
    }
    if (item.type === "ideas") {
        return card(r.title || "Untitled idea", r.body, r.tags, null, CATEGORY_LABELS[r.category]);
    }
    return "";
}

function card(title, snippet, tags = [], moodIcon = null, category = null) {
    const snippetText = (snippet || "").trim().slice(0, 220);
    return `
        <div class="searchResultCard">
            ${title || moodIcon || category ? `
                <div class="searchResultCardHeader">
                    ${title ? `<span class="searchResultCardTitle">${escapeHtml(title)}</span>` : ""}
                    ${moodIcon ? `<span class="searchResultCardMood">${moodIcon}</span>` : ""}
                    ${category ? `<span class="searchResultCardCategory">${escapeHtml(category)}</span>` : ""}
                </div>
            ` : ""}
            ${snippetText ? `<p class="searchResultCardSnippet">${escapeHtml(snippetText)}${snippet.length > 220 ? "…" : ""}</p>` : ""}
            ${tags.length ? `<div class="searchResultCardTags">${tags.map(t => `<span class="searchResultCardTag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        </div>
    `;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return tmp.textContent || "";
}

function escapeHtml(str) {
    const tmp = document.createElement("div");
    tmp.textContent = str;
    return tmp.innerHTML;
}