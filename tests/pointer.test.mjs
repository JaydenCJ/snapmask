// JSON Pointer plumbing: RFC 6901 escaping, lookup, and the `*`
// wildcard extension used by learned rules.
import test from "node:test";
import assert from "node:assert/strict";

import {
  escapeSegment,
  formatPointer,
  generalizePointer,
  getAtPointer,
  parsePointer,
  pointerMatches,
  unescapeSegment,
} from "../dist/index.js";

test("escaping follows RFC 6901, and unescape order matters (~01 is ~1, not /)", () => {
  assert.equal(escapeSegment("a/b~c"), "a~1b~0c");
  assert.equal(unescapeSegment("a~1b~0c"), "a/b~c");
  assert.equal(unescapeSegment("~01"), "~1");
});

test("format and parse round-trip, including keys that need escaping", () => {
  const segments = ["items", "0", "unit/price", "wei~rd"];
  const pointer = formatPointer(segments);
  assert.equal(pointer, "/items/0/unit~1price/wei~0rd");
  assert.deepEqual(parsePointer(pointer), segments);
});

test("the root pointer is the empty string; slash-less pointers are rejected", () => {
  assert.equal(formatPointer([]), "");
  assert.deepEqual(parsePointer(""), []);
  assert.throws(() => parsePointer("items/0"), /must start with/);
});

test("getAtPointer walks objects and arrays; absent paths and sloppy indices are undefined", () => {
  const doc = { items: [{ sku: "A" }, { sku: "B" }], total: 2 };
  assert.equal(getAtPointer(doc, ["items", "1", "sku"]), "B");
  assert.equal(getAtPointer(doc, ["total"]), 2);
  assert.equal(getAtPointer(doc, ["items", "5", "sku"]), undefined);
  assert.equal(getAtPointer(doc, ["missing"]), undefined);
  assert.equal(getAtPointer(doc, ["items", "01"]), undefined); // non-canonical index
  assert.equal(getAtPointer(doc, ["items", "-1"]), undefined);
});

test("wildcards: * matches exactly one segment; generalize stars out only array indices", () => {
  assert.ok(pointerMatches(["items", "*", "id"], ["items", "7", "id"]));
  assert.ok(!pointerMatches(["items", "*", "id"], ["items", "7", "id", "x"]));
  assert.ok(!pointerMatches(["items", "*"], ["orders", "7"]));
  // /byYear/2026/0 — "2026" is an object key, "0" indexes an array.
  const generalized = generalizePointer(["byYear", "2026", "0"], [false, false, true]);
  assert.deepEqual(generalized, ["byYear", "2026", "*"]);
});
