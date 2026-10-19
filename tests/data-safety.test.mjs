import test from "node:test";
import assert from "node:assert/strict";
import {
    COLLECTION_NAMES,
    setStorageProfile,
    openCollection,
    readCollectionsSnapshot,
    replaceCollections
} from "../js/store.js";

class MemoryStorage {
    constructor(seed = {}) {
        this.values = new Map(Object.entries(seed));
        this.failOnceForKey = null;
    }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
    setItem(key, value) {
        key = String(key);
        if (this.failOnceForKey === key) {
            this.failOnceForKey = null;
            throw new Error("simulated storage write failure");
        }
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(String(key)); }
    clear() { this.values.clear(); }
}

function freshStorage(seed = {}) {
    globalThis.localStorage = new MemoryStorage(seed);
    globalThis.window = { dispatchEvent() {} };
    setStorageProfile("account");
    return globalThis.localStorage;
}

function emptyCollections() {
    return Object.fromEntries(COLLECTION_NAMES.map(name => [name, []]));
}

test("account and guest collections remain isolated", () => {
    const storage = freshStorage();
    openCollection("entries").create({ title: "account record" });
    setStorageProfile("guest");
    openCollection("entries").create({ title: "guest record" });
    assert.equal(JSON.parse(storage.getItem("chronicle.entries")).length, 1);
    assert.equal(JSON.parse(storage.getItem("chronicle.guest.entries")).length, 1);
    assert.equal(openCollection("entries").all()[0].title, "guest record");
    setStorageProfile("account");
    assert.equal(openCollection("entries").all()[0].title, "account record");
});

test("a malformed primary collection is recovered from its last known-good copy", () => {
    const expected = [{ id: "known-good", title: "preserve me" }];
    const storage = freshStorage({
        "chronicle.entries": "{broken json",
        "chronicle.recovery.entries": JSON.stringify(expected)
    });
    assert.deepEqual(openCollection("entries").all(), expected);
    assert.equal(storage.getItem("chronicle.entries"), JSON.stringify(expected));
});

test("unreadable records without a recovery copy are not overwritten by a write", () => {
    const raw = "{broken json";
    const storage = freshStorage({ "chronicle.entries": raw });
    assert.throws(() => openCollection("entries").create({ title: "new record" }), /unreadable/i);
    assert.equal(storage.getItem("chronicle.entries"), raw);
});

test("backup snapshots stop rather than silently exporting an incomplete collection", () => {
    freshStorage({ "chronicle.entries": "{broken json" });
    assert.throws(() => readCollectionsSnapshot(), /unreadable/i);
});

test("incomplete or invalid replacement data is rejected before any collection changes", () => {
    const seed = Object.fromEntries(COLLECTION_NAMES.map(name => ["chronicle." + name, JSON.stringify([{ id: name, title: "original" }])]));
    const storage = freshStorage(seed);
    assert.throws(() => replaceCollections({ entries: [] }), /incomplete/i);
    const invalid = emptyCollections();
    invalid.ideas = [null];
    assert.throws(() => replaceCollections(invalid), /invalid/i);
    for (const name of COLLECTION_NAMES) {
        assert.deepEqual(JSON.parse(storage.getItem("chronicle." + name)), [{ id: name, title: "original" }]);
    }
});

test("a failed multi-collection replacement rolls all primary collections back", () => {
    const seed = Object.fromEntries(COLLECTION_NAMES.map(name => ["chronicle." + name, JSON.stringify([{ id: name, title: "original" }])]));
    const storage = freshStorage(seed);
    const replacement = Object.fromEntries(COLLECTION_NAMES.map(name => [name, [{ id: name + "-new", title: "replacement" }]]));
    storage.failOnceForKey = "chronicle.ideas";
    assert.throws(() => replaceCollections(replacement), /could not be applied/i);
    for (const name of COLLECTION_NAMES) {
        assert.deepEqual(JSON.parse(storage.getItem("chronicle." + name)), [{ id: name, title: "original" }]);
    }
});

test("a valid full replacement preserves all four collections", () => {
    freshStorage();
    const replacement = Object.fromEntries(COLLECTION_NAMES.map(name => [name, [{ id: name + "-1", title: name }]]));
    const counts = replaceCollections(replacement);
    assert.deepEqual(counts, Object.fromEntries(COLLECTION_NAMES.map(name => [name, 1])));
    assert.deepEqual(readCollectionsSnapshot(), replacement);
});
