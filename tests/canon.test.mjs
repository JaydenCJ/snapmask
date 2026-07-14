// Canonical form: key order must never flip a snapshot, array order
// must always be preserved, and serialization must be byte-stable.
import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJson, canonicalize, deepEqual, parseJsonDocument } from "../dist/index.js";

test("object keys are sorted recursively; array order is untouched", () => {
  const doc = { b: 1, a: { z: [3, 1, 2], y: true } };
  assert.equal(JSON.stringify(canonicalize(doc)), '{"a":{"y":true,"z":[3,1,2]},"b":1}');
});

test("canonicalJson is byte-identical across key-order permutations and normalizes -0", () => {
  const a = canonicalJson({ x: 1, y: { b: 2, a: 3 } });
  const b = canonicalJson({ y: { a: 3, b: 2 }, x: 1 });
  assert.equal(a, b);
  assert.ok(a.endsWith("\n"), "serialized snapshots end with a newline");
  assert.ok(Object.is(canonicalize(-0), 0)); // JSON.parse can produce -0
  assert.equal(canonicalJson([-0]), "[\n  0\n]\n");
});

test("canonicalize is a deep copy — mutating the result leaves the input intact", () => {
  const doc = { a: { b: [1] } };
  const copy = canonicalize(doc);
  copy.a.b.push(2);
  assert.deepEqual(doc.a.b, [1]);
});

test("deepEqual ignores key order but not array order, and separates null/{}/[]", () => {
  assert.ok(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }));
  assert.ok(!deepEqual({ b: [1, 2] }, { b: [2, 1] }));
  assert.ok(!deepEqual(null, {}));
  assert.ok(!deepEqual({}, []));
  assert.ok(!deepEqual({ a: null }, {}));
});

test("parseJsonDocument labels its errors with the input name", () => {
  assert.throws(() => parseJsonDocument("{nope", "runs/a.json"), /runs\/a\.json: not valid JSON/);
  assert.deepEqual(parseJsonDocument('{"ok":1}', "x"), { ok: 1 });
});
