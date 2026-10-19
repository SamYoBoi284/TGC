import test from "node:test";
import assert from "node:assert/strict";
import { migrateGuestDataToAccount, previewGuestMigration } from "../js/migration.js";
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

test("account and guest storage remain separate before explicit migration", () => {
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


function seedProfiles(accountCollections, guestCollections) {
    const seed = {};
    for (const name of COLLECTION_NAMES) {
        seed["chronicle." + name] = JSON.stringify(accountCollections[name] || []);
        seed["chronicle.guest." + name] = JSON.stringify(guestCollections[name] || []);
    }
    return freshStorage(seed);
}

test("explicit migration merges distinct guest records into account and retains guest source", () => {
    const account = emptyCollections(), guest = emptyCollections();
    account.entries = [{ id: "account-1", title: "Account record" }];
    guest.entries = [{ id: "guest-1", title: "Guest record" }];
    const storage = seedProfiles(account, guest);
    setStorageProfile("account");
    const result = migrateGuestDataToAccount();
    const merged = JSON.parse(storage.getItem("chronicle.entries"));
    assert.deepEqual(merged.map(record => record.id), ["account-1", "guest-1"]);
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.guest.entries")), guest.entries);
    assert.equal(result.rows.entries.guestToImport, 1);
    assert.ok(storage.getItem(result.backupKey), "pre-migration account safety backup should exist");
});

test("migration deduplicates identical records and preserves same-ID conflicts", () => {
    const account = emptyCollections(), guest = emptyCollections();
    account.entries = [{ id: "same-id", title: "Account version" }, { id: "duplicate", title: "Same content" }];
    guest.entries = [{ id: "same-id", title: "Guest version" }, { id: "duplicate", title: "Same content" }];
    const storage = seedProfiles(account, guest);
    setStorageProfile("account");
    const preview = previewGuestMigration();
    assert.equal(preview.rows.entries.guestConflicts, 1);
    assert.equal(preview.rows.entries.guestDuplicates, 1);
    migrateGuestDataToAccount();
    const merged = JSON.parse(storage.getItem("chronicle.entries"));
    assert.equal(merged.length, 3);
    assert.equal(merged.filter(record => record.id === "same-id").length, 1);
    assert.equal(merged.filter(record => record.title === "Guest version").length, 1);
    assert.equal(merged.filter(record => record.title === "Guest version")[0].migrationSourceProfile, "guest");
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.guest.entries")), guest.entries);
});

test("repeating guest migration does not add duplicate imported records", () => {
    const account = emptyCollections(), guest = emptyCollections();
    account.entries = [{ id: "account-1", title: "Account record" }];
    guest.entries = [{ id: "guest-1", title: "Guest record" }];
    const storage = seedProfiles(account, guest);
    setStorageProfile("account");
    migrateGuestDataToAccount();
    const first = JSON.parse(storage.getItem("chronicle.entries"));
    migrateGuestDataToAccount();
    const second = JSON.parse(storage.getItem("chronicle.entries"));
    assert.equal(second.length, first.length);
    assert.deepEqual(second, first);
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.guest.entries")), guest.entries);
});

test("migration is blocked in guest profile without changing either profile", () => {
    const account = emptyCollections(), guest = emptyCollections();
    account.entries = [{ id: "account-1", title: "Account record" }];
    guest.entries = [{ id: "guest-1", title: "Guest record" }];
    const storage = seedProfiles(account, guest);
    setStorageProfile("guest");
    assert.throws(() => migrateGuestDataToAccount(), /switch to your google account profile/i);
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.entries")), account.entries);
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.guest.entries")), guest.entries);
});

test("migration stops if its safety backup cannot be saved and leaves source data intact", () => {
    const account = emptyCollections(), guest = emptyCollections();
    account.entries = [{ id: "account-1", title: "Account record" }];
    guest.entries = [{ id: "guest-1", title: "Guest record" }];
    const storage = seedProfiles(account, guest);
    setStorageProfile("account");
    storage.failOnceForKey = [...storage.values.keys()].find(key => key.startsWith("chronicle.migrationBackup."));
    // No backup key exists yet; target the deterministic next storage write by using a proxy-style failure.
    storage.setItem = function(key, value) {
        key = String(key);
        if (key.startsWith("chronicle.migrationBackup.")) throw new Error("simulated backup write failure");
        this.values.set(key, String(value));
    };
    assert.throws(() => migrateGuestDataToAccount(), /safety backup/i);
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.entries")), account.entries);
    assert.deepEqual(JSON.parse(storage.getItem("chronicle.guest.entries")), guest.entries);
});
