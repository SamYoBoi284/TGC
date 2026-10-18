// ===========================================
// The Glitchcore Chronicle
// js/timeline.js
// MILESTONE 6: Timeline
// ===========================================
//
// Owns the Timeline route entirely. Read-only — Timeline doesn't
// create or edit anything, it just re-reads the four existing
// collections (entries, braindump, milestones, ideas) straight out
// of store.js and indexes them by day. Per the README: browse by
// year, then month, then day; clicking a day opens everything
// recorded that day, across every collection.
//
// Each collection carries its "when this happened" date on a
// differently-named field (entries.date is a plain YYYY-MM-DD user
// pick, braindump/ideas ride store.js's own createdAt, milestones
// freezes occurredAt) — the read + that field-flattening now lives in
// js/collections.js (extracted in Milestone 7, since Search needs the
// exact same cross-collection read). Nothing here writes back to any
// collection, so getting this wrong can't corrupt data, only misfile
// it in the browse tree.

import { getAllItems } from "./collections.js";

const MOOD_ICONS = { great: "😁", good: "🙂", neutral: "😐", bad: "😕", terrible: "😭" };

// Drill-down state. "years" is always the entry level; back() walks
// this back up one level at a time toward it.
let level = "years"; // "years" | "months" | "days"
let selectedYear = null;
let selectedMonth = null; // 1-12
let selectedDay = null;   // "YYYY-MM-DD", set once a day is opened in the right panel

export function initTimeline() {
    const root = document.getElementById("timelinePage");
    if (!root) return;

    root.innerHTML = buildShell();
    renderNav();
    renderDayView();
}

// ---------------------------------------------------------------
// Shell markup
// ---------------------------------------------------------------

function buildShell() {
    return `
        <div id="timelineLayout">
            <aside id="timelineNavPanel">
                <div id="timelineNavHeader">
                    <button type="button" id="timelineBackButton" title="Back" disabled>‹</button>
                    <span id="timelineNavHeading">All Years</span>
                </div>
                <div id="timelineNavScroll"></div>
            </aside>

            <section id="timelineDayPanel">
                <div id="timelineDayScroll"></div>
            </section>
        </div>
    `;
}

// ---------------------------------------------------------------
// Data indexing
// ---------------------------------------------------------------

// Every non-archived dated item across all four collections, each
// carrying a normalized local "YYYY-MM-DD" key. The read itself now
// lives in js/collections.js — this just filters out anything that
// somehow ended up without a resolvable date.
function collectDatedItems() {
    return getAllItems().filter(i => i.dateKey);
}

// Builds { "2026": { 7: { "2026-07-22": [items...] } } } — years and
// months descending is handled at render time, not here.
function buildTree() {
    const tree = {};

    collectDatedItems().forEach(item => {
        const [yearStr, monthStr] = item.dateKey.split("-");
        const year = yearStr;
        const month = Number(monthStr);

        if (!tree[year]) tree[year] = {};
        if (!tree[year][month]) tree[year][month] = {};
        if (!tree[year][month][item.dateKey]) tree[year][month][item.dateKey] = [];

        tree[year][month][item.dateKey].push(item);
    });

    return tree;
}

// ---------------------------------------------------------------
// Nav panel (years -> months -> days)
// ---------------------------------------------------------------

function renderNav() {
    const scroll = document.getElementById("timelineNavScroll");
    const heading = document.getElementById("timelineNavHeading");
    const backButton = document.getElementById("timelineBackButton");
    if (!scroll) return;

    const tree = buildTree();
    backButton.disabled = level === "years";
    backButton.onclick = back;

    if (level === "years") {
        heading.textContent = "All Years";
        const years = Object.keys(tree).sort((a, b) => b.localeCompare(a));
        scroll.innerHTML = years.length
            ? years.map(year => renderNavRow(year, countInYear(tree, year))).join("")
            : emptyNavMessage("Nothing recorded yet.");
        wireNavRows(scroll, year => { selectedYear = year; selectedMonth = null; level = "months"; renderNav(); });
        return;
    }

    if (level === "months") {
        heading.textContent = selectedYear;
        const months = Object.keys(tree[selectedYear] || {}).sort((a, b) => b - a);
        scroll.innerHTML = months.length
            ? months.map(month => renderNavRow(monthName(month), countInMonth(tree, selectedYear, month), month)).join("")
            : emptyNavMessage("Nothing recorded this year.");
        wireNavRows(scroll, month => { selectedMonth = Number(month); level = "days"; renderNav(); });
        return;
    }

    // level === "days"
    heading.textContent = `${monthName(selectedMonth)} ${selectedYear}`;
    const days = Object.keys(tree[selectedYear]?.[selectedMonth] || {}).sort((a, b) => b.localeCompare(a));
    scroll.innerHTML = days.length
        ? days.map(dateKey => renderNavRow(formatDayLabel(dateKey), tree[selectedYear][selectedMonth][dateKey].length, dateKey)).join("")
        : emptyNavMessage("Nothing recorded this month.");
    wireNavRows(scroll, dateKey => { selectedDay = dateKey; renderDayView(); highlightSelectedDay(); });

    highlightSelectedDay();
}

function renderNavRow(label, count, value) {
    return `
        <div class="timelineNavRow" data-value="${escapeAttr(value ?? label)}">
            <span class="timelineNavRowLabel">${escapeHtml(String(label))}</span>
            <span class="timelineNavRowCount">${count}</span>
        </div>
    `;
}

function wireNavRows(scroll, onSelect) {
    scroll.querySelectorAll(".timelineNavRow").forEach(row => {
        row.addEventListener("click", () => onSelect(row.dataset.value));
    });
}

function highlightSelectedDay() {
    if (level !== "days") return;
    document.querySelectorAll(".timelineNavRow").forEach(row => {
        row.classList.toggle("timelineNavRowActive", row.dataset.value === selectedDay);
    });
}

function back() {
    if (level === "days") { level = "months"; selectedDay = null; }
    else if (level === "months") { level = "years"; selectedMonth = null; }
    renderNav();
}

function countInYear(tree, year) {
    return Object.values(tree[year]).reduce((sum, days) => sum + countInDays(days), 0);
}

function countInMonth(tree, year, month) {
    return countInDays(tree[year][month]);
}

function countInDays(days) {
    return Object.values(days).reduce((sum, items) => sum + items.length, 0);
}

function emptyNavMessage(text) {
    return `<p id="timelineNavEmpty">${text}</p>`;
}

function monthName(monthNumber) {
    return new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2000, Number(monthNumber) - 1, 1));
}

// ---------------------------------------------------------------
// Day panel (everything recorded on the selected day)
// ---------------------------------------------------------------

function renderDayView() {
    const scroll = document.getElementById("timelineDayScroll");
    if (!scroll) return;

    if (!selectedDay) {
        scroll.innerHTML = `
            <div id="timelineDayEmpty">
                <p>Select a day to see what happened.</p>
            </div>
        `;
        return;
    }

    const items = collectDatedItems().filter(i => i.dateKey === selectedDay);

    if (!items.length) {
        scroll.innerHTML = `
            <div id="timelineDayEmpty">
                <p>Nothing recorded on ${formatDayLabel(selectedDay)}.</p>
            </div>
        `;
        return;
    }

    const order = ["entries", "braindump", "milestones", "ideas"];
    const grouped = order
        .map(type => ({ type, items: items.filter(i => i.type === type) }))
        .filter(group => group.items.length);

    scroll.innerHTML = `
        <h2 id="timelineDayHeading">${formatDayLabel(selectedDay)}</h2>
        ${grouped.map(renderDayGroup).join("")}
    `;
}

function renderDayGroup(group) {
    return `
        <div class="timelineDayGroup">
            <h3 class="timelineDayGroupTitle">${groupTitle(group.type)}</h3>
            <div class="timelineDayGroupItems">
                ${group.items.map(renderDayCard).join("")}
            </div>
        </div>
    `;
}

function groupTitle(type) {
    return { entries: "Entries", braindump: "Brain Dump", milestones: "Milestones", ideas: "Ideas" }[type];
}

function renderDayCard(item) {
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
        return card(r.title || "Untitled idea", r.body, r.tags, null, r.category);
    }
    return "";
}

function card(title, snippet, tags = [], moodIcon = null, category = null) {
    const snippetText = (snippet || "").trim().slice(0, 220);
    return `
        <div class="timelineDayCard">
            ${title || moodIcon || category ? `
                <div class="timelineDayCardHeader">
                    ${title ? `<span class="timelineDayCardTitle">${escapeHtml(title)}</span>` : ""}
                    ${moodIcon ? `<span class="timelineDayCardMood">${moodIcon}</span>` : ""}
                    ${category ? `<span class="timelineDayCardCategory">${escapeHtml(category)}</span>` : ""}
                </div>
            ` : ""}
            ${snippetText ? `<p class="timelineDayCardSnippet">${escapeHtml(snippetText)}${snippet.length > 220 ? "…" : ""}</p>` : ""}
            ${tags.length ? `<div class="timelineDayCardTags">${tags.map(t => `<span class="timelineDayCardTag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        </div>
    `;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function formatDayLabel(dateKey) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
        .format(new Date(`${dateKey}T00:00:00`));
}

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

function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
}