// ===========================================
// The Glitchcore Chronicle
// js/archive.js
// MILESTONE 11: Archive
// ===========================================
//
// Owns the Archive route. Nothing in Chronicle is ever hard-deleted
// — store.js's archive() has flagged records this way since
// Milestone 2, but until now there was no way to see or get them
// back once archived. This is that view: every archived item across
// all four collections, grouped like Timeline/Search, each with a
// Restore button. No hard-delete button exists here or anywhere —
// that stays intentionally unwired to any UI, per the "nothing is
// ever permanently deleted" rule.
//
// Reacts to "chronicle:change" (Milestone 10's event) so restoring
// an item elsewhere, or a fresh archive() call from another view,
// updates this list immediately without a manual refresh.

import { getArchivedItems, restoreItem, COLLECTION_TYPES } from "./collections.js";

const MOOD_ICONS = { great: "😁", good: "🙂", neutral: "😐", bad: "😕", terrible: "😭" };
const CATEGORY_LABELS = { coding: "Coding", music: "Music", random: "Random Thought", future: "Future Plan" };

export function initArchive() {
    const root = document.getElementById("archivePage");
    if (!root) return;

    root.innerHTML = buildShell();
    render();

    window.addEventListener("chronicle:change", render);

    root.addEventListener("click", e => {
        const button = e.target.closest(".archiveRestoreButton");
        if (!button) return;
        restoreItem(button.dataset.type, button.dataset.id);
        // render() also fires from the "chronicle:change" event that
        // restoreItem -> store.js's update() triggers, but calling it
        // here too keeps the click feeling instant either way.
        render();
    });
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildShell() {
    return `
        <div id="archiveLayout">
            <div id="archiveHeader">
                <h2 id="archiveHeaderTitle">Archive</h2>
                <p id="archiveHeaderSubtitle">Nothing is ever permanently deleted. Restore anything from here.</p>
            </div>
            <div id="archiveResultsScroll"></div>
        </div>
    `;
}

// ---------------------------------------------------------------
// Results
// ---------------------------------------------------------------

function render() {
    const scroll = document.getElementById("archiveResultsScroll");
    if (!scroll) return;

    const archived = getArchivedItems();

    if (!archived.length) {
        scroll.innerHTML = `
            <div id="archiveEmptyState">
                <p>Nothing archived yet.</p>
            </div>
        `;
        return;
    }

    const grouped = COLLECTION_TYPES
        .map(({ type, label }) => ({
            type,
            label,
            items: archived
                .filter(item => item.type === type)
                .sort((a, b) => new Date(b.record.updatedAt) - new Date(a.record.updatedAt))
        }))
        .filter(group => group.items.length);

    scroll.innerHTML = grouped.map(renderGroup).join("");
}

function renderGroup(group) {
    return `
        <div class="archiveResultGroup">
            <h3 class="archiveResultGroupTitle">${escapeHtml(group.label)} <span class="archiveResultGroupCount">${group.items.length}</span></h3>
            <div class="archiveResultGroupItems">
                ${group.items.map(item => renderCard(item)).join("")}
            </div>
        </div>
    `;
}

function renderCard(item) {
    const r = item.record;

    if (item.type === "entries") {
        return card(item.type, r.id, r.title || "Untitled entry", stripHtml(r.body), r.tags, r.mood ? MOOD_ICONS[r.mood] : null);
    }
    if (item.type === "braindump") {
        return card(item.type, r.id, null, r.body, []);
    }
    if (item.type === "milestones") {
        return card(item.type, r.id, r.title || "Untitled milestone", r.description, r.tags);
    }
    if (item.type === "ideas") {
        return card(item.type, r.id, r.title || "Untitled idea", r.body, r.tags, null, CATEGORY_LABELS[r.category]);
    }
    return "";
}

function card(type, id, title, snippet, tags = [], moodIcon = null, category = null) {
    const snippetText = (snippet || "").trim().slice(0, 220);
    return `
        <div class="archiveResultCard">
            <div class="archiveResultCardBody">
                ${title || moodIcon || category ? `
                    <div class="archiveResultCardHeader">
                        ${title ? `<span class="archiveResultCardTitle">${escapeHtml(title)}</span>` : ""}
                        ${moodIcon ? `<span class="archiveResultCardMood">${moodIcon}</span>` : ""}
                        ${category ? `<span class="archiveResultCardCategory">${escapeHtml(category)}</span>` : ""}
                    </div>
                ` : ""}
                ${snippetText ? `<p class="archiveResultCardSnippet">${escapeHtml(snippetText)}${snippet.length > 220 ? "…" : ""}</p>` : ""}
                ${tags.length ? `<div class="archiveResultCardTags">${tags.map(t => `<span class="archiveResultCardTag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
            </div>
            <button type="button" class="archiveRestoreButton" data-type="${type}" data-id="${id}">Restore</button>
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