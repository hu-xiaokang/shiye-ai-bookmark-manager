import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadBookmarkModel() {
  const context = { globalThis: null, Date };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL("../bookmark-model.js", import.meta.url), "utf8"), context);
  return context.BookmarkModel;
}

test("read-later is an independent expiring marker, not a category", () => {
  const model = loadBookmarkModel();
  const now = Date.parse("2026-07-12T10:00:00.000Z");
  assert.equal(model.DEFAULT_READ_LATER_DURATION_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(model.normalizeReadLaterExpiryDays(undefined), 7);
  assert.equal(model.normalizeReadLaterExpiryDays("14"), 14);
  assert.equal(model.defaultReadLaterUntil({ readLaterDefaultExpiryDays: 0 }, now), null);
  assert.equal(model.defaultReadLaterUntil({ readLaterDefaultExpiryDays: 3 }, now), "2026-07-15T10:00:00.000Z");

  assert.deepEqual(
    [...model.normalizeCategories(["技术开发", "稍后阅读", "技术开发"])],
    ["技术开发"]
  );
  assert.equal(model.isReadLaterActive({ readLater: true, readLaterUntil: null }, now), true);
  assert.equal(model.isReadLaterActive({ readLater: true, readLaterUntil: "2026-07-12T10:01:00.000Z" }, now), true);
  assert.equal(model.isReadLaterActive({ readLater: true, readLaterUntil: "2026-07-12T09:59:00.000Z" }, now), false);
  assert.equal(model.isReadLaterActive({ readLater: false, readLaterUntil: "2026-07-12T10:01:00.000Z" }, now), false);

  const sorted = [
    { id: "no-expiry", readLaterUntil: null },
    { id: "later", readLaterUntil: "2026-07-14T10:00:00.000Z" },
    { id: "soon", readLaterUntil: "2026-07-12T10:01:00.000Z" }
  ].sort(model.compareReadLaterExpiry);
  assert.deepEqual(sorted.map(item => item.id), ["soon", "later", "no-expiry"]);
});
