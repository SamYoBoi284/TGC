// ===========================================
// The Glitchcore Chronicle
// js/home.js
// MILESTONE 1: Foundation
// MILESTONE 10: Reactive Home Widgets
// ===========================================
//
// Home page logic: live date/time (Syria's timezone, IANA-correct
// so DST is handled automatically), a time-of-day greeting, and the
// three widgets that were static placeholders until now — Recent
// Entries, Today's Mood, Statistics. (On This Day owns itself, in
// js/onthisday.js, unchanged here.)
//
// All three widgets re-render on every "chronicle:change" event
// (dispatched by store.js's writeCollection()) so they stay live the
// instant something is added, edited, or archived — no polling
// needed for that part, same posture On This Day now also has.

import { getAllItems } from "./collections.js";

const TIMEZONE = "Asia/Damascus";
const MOOD_ICONS = { great: "😁", good: "🙂", neutral: "😐", bad: "😕", terrible: "😭" };
const MOOD_LABELS = { great: "Great", good: "Good", neutral: "Neutral", bad: "Bad", terrible: "Terrible" };

export function initHome() {
    updateDateTime();
    setInterval(updateDateTime, 1000 * 30); // clock, not a stopwatch — 30s is plenty

    renderRecentEntries();
    renderTodaysMood();
    renderStatistics();

    window.addEventListener("chronicle:change", () => {
        renderRecentEntries();
        renderTodaysMood();
        renderStatistics();
    });
}

function updateDateTime() {
    const now = new Date();

    const greetingEl = document.getElementById("homeGreetingText");
    const dateTimeEl = document.getElementById("homeDateTimeText");
    if (!greetingEl || !dateTimeEl) return;

    greetingEl.textContent = greetingFor(now);
    dateTimeEl.textContent = formatDateTime(now);
}

function greetingFor(date) {
    const hour = Number(new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        hour: "numeric",
        hour12: false
    }).format(date));

    if (hour < 5) return "Still up?";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

function formatDateTime(date) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(date);
}

// ---------------------------------------------------------------
// Recent Entries
// ---------------------------------------------------------------

function renderRecentEntries() {
    const root = document.getElementById("recentEntriesContent");
    if (!root) return;

    const entries = getAllItems()
        .filter(item => item.type === "entries")
        .sort((a, b) => new Date(b.record.createdAt) - new Date(a.record.createdAt))
        .slice(0, 5);

    if (!entries.length) {
        root.innerHTML = `<p class="homeWidgetPlaceholder">Nothing recorded yet.</p>`;
        return;
    }

    root.innerHTML = `
        <ul class="homeWidgetList">
            ${entries.map(item => {
                const r = item.record;
                return `
                    <li class="homeWidgetListItem">
                        <span class="homeWidgetListItemTitle">${escapeHtml(r.title || "Untitled entry")}</span>
                        ${r.mood ? `<span class="homeWidgetListItemMood">${MOOD_ICONS[r.mood] || ""}</span>` : ""}
                    </li>
                `;
            }).join("")}
        </ul>
    `;
}

// ---------------------------------------------------------------
// Today's Mood
// ---------------------------------------------------------------

function renderTodaysMood() {
    const root = document.getElementById("todaysMoodContent");
    if (!root) return;

    const todayKey = todayInTimezone();

    const todaysMoodEntry = getAllItems()
        .filter(item => item.type === "entries" && item.record.mood && item.dateKey === todayKey)
        .sort((a, b) => new Date(b.record.createdAt) - new Date(a.record.createdAt))[0];

    if (!todaysMoodEntry) {
        root.innerHTML = `<p class="homeWidgetPlaceholder">Not set yet.</p>`;
        return;
    }

    const mood = todaysMoodEntry.record.mood;
    root.innerHTML = `
        <div class="homeWidgetMoodDisplay">
            <span class="homeWidgetMoodIcon">${MOOD_ICONS[mood] || ""}</span>
            <span class="homeWidgetMoodLabel">${MOOD_LABELS[mood] || mood}</span>
        </div>
    `;
}

// ---------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------

function renderStatistics() {
    const root = document.getElementById("statisticsContent");
    if (!root) return;

    const items = getAllItems();

    if (!items.length) {
        root.innerHTML = `<p class="homeWidgetPlaceholder">Nothing to show yet.</p>`;
        return;
    }

    const counts = {
        entries: items.filter(i => i.type === "entries").length,
        braindump: items.filter(i => i.type === "braindump").length,
        milestones: items.filter(i => i.type === "milestones").length,
        ideas: items.filter(i => i.type === "ideas").length
    };

    root.innerHTML = `
        <ul class="homeWidgetStatList">
            <li class="homeWidgetStatItem"><span>Entries</span><span>${counts.entries}</span></li>
            <li class="homeWidgetStatItem"><span>Brain Dump</span><span>${counts.braindump}</span></li>
            <li class="homeWidgetStatItem"><span>Milestones</span><span>${counts.milestones}</span></li>
            <li class="homeWidgetStatItem"><span>Ideas</span><span>${counts.ideas}</span></li>
        </ul>
    `;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function todayInTimezone() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}

function escapeHtml(str) {
    const tmp = document.createElement("div");
    tmp.textContent = str;
    return tmp.innerHTML;
}
