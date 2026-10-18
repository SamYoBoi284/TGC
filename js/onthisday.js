// ===========================================
// The Glitchcore Chronicle
// js/onthisday.js
// MILESTONE 8: On This Day
// ===========================================
//
// Owns the "On This Day" home widget. Per the README: every day the
// app should surface whatever was recorded on this same calendar
// date in earlier years ("One year ago today..."). Read-only, same
// posture as Timeline and Search — it re-reads all four collections
// through js/collections.js rather than opening its own or
// duplicating the read.
//
// "Today" is resolved in Asia/Damascus, matching the date shown in
// the greeting block (js/home.js) so the widget never disagrees with
// the date printed right above it. That timezone constant is
// duplicated here rather than imported, same call Timeline and
// Search already made with MOOD_ICONS — one small constant per
// isolated module beats a shared-constants dependency.

import { getAllItems } from "./collections.js";

const TIMEZONE = "Asia/Damascus";
const MOOD_ICONS = { great: "😁", good: "🙂", neutral: "😐", bad: "😕", terrible: "😭" };
const CATEGORY_LABELS = { coding: "Coding", music: "Music", random: "Random Thought", future: "Future Plan" };

// Tracks the Asia/Damascus calendar day this widget last rendered
// for, so a long-running window catches the rollover past midnight
// without re-rendering on every tick.
let lastRenderedDateKey = null;

export function initOnThisDay() {
    const root = document.getElementById("onThisDayContent");
    if (!root) return;

    render();
    setInterval(checkForDayRollover, 1000 * 60); // cheap check, real work only happens on rollover

    // MILESTONE 10: Reactive Home Widgets
    // Any collection write now re-renders immediately, on top of the
    // existing midnight-rollover poll above (kept as-is — it's still
    // needed for the case where nothing gets written but the day
    // rolls over anyway).
    window.addEventListener("chronicle:change", render);
}

function checkForDayRollover() {
    if (getTodayInfo().todayKey !== lastRenderedDateKey) render();
}

// ---------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------

function render() {
    const root = document.getElementById("onThisDayContent");
    if (!root) return;

    const today = getTodayInfo();
    lastRenderedDateKey = today.todayKey;

    const groups = groupByYear(collectPastYearMatches(today));

    if (!groups.length) {
        root.innerHTML = `<p class="homeWidgetPlaceholder">No memories from past years yet.</p>`;
        return;
    }

    root.innerHTML = groups.map(group => renderYearGroup(group, today.year)).join("");
}

// Every non-archived item across all four collections whose dateKey
// falls on today's month/day in some earlier year.
function collectPastYearMatches(today) {
    return getAllItems().filter(item => {
        if (!item.dateKey) return false;
        const [yearStr, monthDay] = [item.dateKey.slice(0, 4), item.dateKey.slice(5)];
        return monthDay === today.monthDay && Number(yearStr) < today.year;
    });
}

// { year -> items[] }, most recent past year first. Item order
// within a year follows getAllItems()'s own collection order
// (Entries, Brain Dump, Milestones, Ideas), same as every other
// cross-collection view.
function groupByYear(items) {
    const years = [...new Set(items.map(i => Number(i.dateKey.slice(0, 4))))].sort((a, b) => b - a);
    return years.map(year => ({
        year,
        items: items.filter(i => Number(i.dateKey.slice(0, 4)) === year)
    }));
}

function renderYearGroup(group, currentYear) {
    return `
        <div class="onThisDayYearGroup">
            <h4 class="onThisDayYearHeading">${yearsAgoLabel(group.year, currentYear)}</h4>
            <div class="onThisDayYearItems">
                ${group.items.map(renderCard).join("")}
            </div>
        </div>
    `;
}

function yearsAgoLabel(year, currentYear) {
    const diff = currentYear - year;
    return `${diff} year${diff === 1 ? "" : "s"} ago`;
}

function renderCard(item) {
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
    const snippetText = (snippet || "").trim().slice(0, 140);
    return `
        <div class="onThisDayCard">
            ${title || moodIcon || category ? `
                <div class="onThisDayCardHeader">
                    ${title ? `<span class="onThisDayCardTitle">${escapeHtml(title)}</span>` : ""}
                    ${moodIcon ? `<span class="onThisDayCardMood">${moodIcon}</span>` : ""}
                    ${category ? `<span class="onThisDayCardCategory">${escapeHtml(category)}</span>` : ""}
                </div>
            ` : ""}
            ${snippetText ? `<p class="onThisDayCardSnippet">${escapeHtml(snippetText)}${snippet.length > 140 ? "…" : ""}</p>` : ""}
            ${tags.length ? `<div class="onThisDayCardTags">${tags.map(t => `<span class="onThisDayCardTag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        </div>
    `;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// en-CA gives a plain YYYY-MM-DD string for a given IANA timezone,
// which is exactly the format collections.js's dateKeys already use.
function getTodayInfo() {
    const todayKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());

    return { todayKey, year: Number(todayKey.slice(0, 4)), monthDay: todayKey.slice(5) };
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
