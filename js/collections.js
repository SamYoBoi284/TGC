// ===========================================
// The Glitchcore Chronicle
// js/collections.js
// MILESTONE 7: Search
// ===========================================
//
// Shared "read across all four collections" helper. Timeline
// (Milestone 6) and Search (Milestone 7) both need to re-read
// entries/braindump/milestones/ideas straight out of store.js and
// treat them as one flat, typed list — this was flagged as technical
// debt after Milestone 4 and deliberately deferred until now, since
// Search is the second module that needs the exact same shape.
//
// Nothing here writes to any collection. Pulling this out doesn't
// change Timeline's behavior at all — normalizeDateKey() and the
// per-type field mapping are moved verbatim, not rewritten.

import { openCollection } from "./store.js";

const entriesStore = openCollection("entries");
const dumpsStore = openCollection("braindump");
const milestonesStore = openCollection("milestones");
const ideasStore = openCollection("ideas");

// Canonical type list + display label, in the same order the
// sidebar (and every cross-collection view since Timeline) uses.
export const COLLECTION_TYPES = [
    { type: "entries", label: "Entries" },
    { type: "braindump", label: "Brain Dump" },
    { type: "milestones", label: "Milestones" },
    { type: "ideas", label: "Ideas" }
];

// Local (not UTC) calendar-day key. Kept exactly as Timeline
// originally wrote it, since entries.js's own date-input default
// relies on the same offset trick.
export function normalizeDateKey(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

// One flat list of every non-archived item across all four
// collections, each carrying its type, a normalized dateKey, and the
// raw record. This is the same shape Timeline built inline before
// this extraction — callers that only care about certain fields
// (title/body/tags for Search, dateKey grouping for Timeline) filter
// or map from here rather than each re-implementing the read.
export function getAllItems() {
    const items = [];

    entriesStore.all().filter(r => !r.archived).forEach(r => {
        items.push({ type: "entries", label: "Entry", record: r, dateKey: r.date || normalizeDateKey(r.createdAt) });
    });

    dumpsStore.all().filter(r => !r.archived).forEach(r => {
        items.push({ type: "braindump", label: "Brain Dump", record: r, dateKey: normalizeDateKey(r.createdAt) });
    });

    milestonesStore.all().filter(r => !r.archived).forEach(r => {
        items.push({ type: "milestones", label: "Milestone", record: r, dateKey: normalizeDateKey(r.occurredAt) });
    });

    ideasStore.all().filter(r => !r.archived).forEach(r => {
        items.push({ type: "ideas", label: "Idea", record: r, dateKey: normalizeDateKey(r.createdAt) });
    });

    return items;
}

// ---------------------------------------------------------------
// MILESTONE 11: Archive
// ---------------------------------------------------------------
// Mirror of getAllItems() above but for archived items only. Kept as
// a separate function rather than an "includeArchived" flag on
// getAllItems() so every existing caller (Timeline, Search, Home,
// On This Day) keeps behaving exactly as before with zero risk of a
// stray archived item leaking into one of those read-only views.

export function getArchivedItems() {
    const items = [];

    entriesStore.all().filter(r => r.archived).forEach(r => {
        items.push({ type: "entries", label: "Entry", record: r, dateKey: r.date || normalizeDateKey(r.createdAt) });
    });

    dumpsStore.all().filter(r => r.archived).forEach(r => {
        items.push({ type: "braindump", label: "Brain Dump", record: r, dateKey: normalizeDateKey(r.createdAt) });
    });

    milestonesStore.all().filter(r => r.archived).forEach(r => {
        items.push({ type: "milestones", label: "Milestone", record: r, dateKey: normalizeDateKey(r.occurredAt) });
    });

    ideasStore.all().filter(r => r.archived).forEach(r => {
        items.push({ type: "ideas", label: "Idea", record: r, dateKey: normalizeDateKey(r.createdAt) });
    });

    return items;
}

const STORES_BY_TYPE = {
    entries: entriesStore,
    braindump: dumpsStore,
    milestones: milestonesStore,
    ideas: ideasStore
};

// Single restore entry point so Archive doesn't need to import
// store.js or know which store backs which type.
export function restoreItem(type, id) {
    const store = STORES_BY_TYPE[type];
    if (!store) return null;
    return store.restore(id);
}