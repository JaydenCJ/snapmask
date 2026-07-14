// Structural diff over masked documents: changed leaves, added and
// removed keys and elements, and deterministic ordering.
import test from "node:test";
import assert from "node:assert/strict";

import { diffDocuments } from "../dist/index.js";

test("equal documents diff to an empty list, regardless of key order", () => {
  assert.deepEqual(diffDocuments({ a: 1, b: [2] }, { b: [2], a: 1 }), []);
});

test("a changed leaf reports path, before and after", () => {
  const diff = diffDocuments({ total: 3 }, { total: 4 });
  assert.deepEqual(diff, [{ path: "/total", type: "changed", before: 3, after: 4 }]);
});

test("added and removed object keys are separate entry types", () => {
  const diff = diffDocuments({ keep: 1, gone: 2 }, { keep: 1, fresh: 3 });
  assert.deepEqual(diff, [
    { path: "/fresh", type: "added", after: 3 },
    { path: "/gone", type: "removed", before: 2 },
  ]);
});

test("array growth/shrinkage report tail elements; a swap is two changes (order is contract)", () => {
  const grew = diffDocuments({ items: [1] }, { items: [1, 2, 3] });
  assert.deepEqual(grew, [
    { path: "/items/1", type: "added", after: 2 },
    { path: "/items/2", type: "added", after: 3 },
  ]);
  const shrank = diffDocuments({ items: [1, 2] }, { items: [1] });
  assert.deepEqual(shrank, [{ path: "/items/1", type: "removed", before: 2 }]);
  const swapped = diffDocuments({ items: ["a", "b"] }, { items: ["b", "a"] });
  assert.deepEqual(swapped.map((d) => d.type), ["changed", "changed"]);
});

test("a shape change (leaf vs container) is a single changed entry, even at the root", () => {
  const diff = diffDocuments({ meta: null }, { meta: { flag: 1 } });
  assert.deepEqual(diff, [
    { path: "/meta", type: "changed", before: null, after: { flag: 1 } },
  ]);
  const root = diffDocuments([1], { a: 1 });
  assert.deepEqual(root, [{ path: "", type: "changed", before: [1], after: { a: 1 } }]);
});

test("entries carry full escaped pointers and come out in sorted walk order", () => {
  const nested = diffDocuments(
    { "a/b": { rows: [{ v: 1 }] } },
    { "a/b": { rows: [{ v: 2 }] } },
  );
  assert.equal(nested[0].path, "/a~1b/rows/0/v");
  const many = diffDocuments({ z: 1, a: 1, m: [1, 2] }, { z: 2, a: 2, m: [1, 3] });
  assert.deepEqual(many.map((d) => d.path), ["/a", "/m/1", "/z"]);
});
