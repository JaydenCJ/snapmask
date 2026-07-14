// Cross-run variance learning: the feature that replaces hand-written
// property-matcher lists. Two runs in, rules out — plus honest
// warnings for shape differences that masking cannot fix.
import test from "node:test";
import assert from "node:assert/strict";

import { classifyVariance, learnRules, maskDocument, mergeRules } from "../dist/index.js";

function paths(result) {
  return result.rules.map((r) => `${r.path}:${r.kind}`);
}

test("identical runs learn nothing; fewer than two runs is an error", () => {
  const run = { total: 3, name: "Ada" };
  const result = learnRules([run, { ...run }]);
  assert.deepEqual(result.rules, []);
  assert.deepEqual(result.warnings, []);
  assert.throws(() => learnRules([{ a: 1 }]), /at least 2 runs/);
});

test("a moving integer becomes a counter rule; a moving float becomes number", () => {
  const ints = learnRules([{ seq: 101 }, { seq: 102 }]);
  assert.deepEqual(paths(ints), ["/seq:counter"]);
  assert.equal(ints.rules[0].source, "variance");
  const floats = learnRules([{ load: 0.42 }, { load: 0.57 }]);
  assert.deepEqual(paths(floats), ["/load:number"]);
});

test("epoch candidates are confirmed by variance with their shape kind", () => {
  const seconds = learnRules([{ at: 1752394530 }, { at: 1752394591 }]);
  assert.deepEqual(paths(seconds), ["/at:epoch-seconds"]);
  const millis = learnRules([{ at: 1752394530123 }, { at: 1752394591456 }]);
  assert.deepEqual(paths(millis), ["/at:epoch-millis"]);
});

test("hex digests that move between runs are confirmed as hex-digest", () => {
  const result = learnRules([
    { etag: "9e107d9d372bb6826bd81d3542a419d6" },
    { etag: "e4d909c290d0fb1ca068ffaddf22cbd0" },
  ]);
  assert.deepEqual(paths(result), ["/etag:hex-digest"]);
});

test("same-shape random strings are tokens; different shapes fall back to value", () => {
  const tokens = learnRules([{ cursor: "hx9f2a7bq0" }, { cursor: "m3k8t1zw5v" }]);
  assert.deepEqual(paths(tokens), ["/cursor:token"]);
  const values = learnRules([{ note: "ok" }, { note: "a much longer sentence here" }]);
  assert.deepEqual(paths(values), ["/note:value"]);
});

test("values that are already confidently masked do not produce rules", () => {
  const result = learnRules([
    { id: "a3bb189e-8bf9-4c8b-9c4b-1a2b3c4d5e6f", at: "2026-07-13T08:15:30Z" },
    { id: "550e8400-e29b-41d4-a716-446655440000", at: "2026-07-13T08:16:02Z" },
  ]);
  assert.deepEqual(result.rules, []);
});

test("array indices generalize to * and merge into a single rule", () => {
  const result = learnRules([
    { items: [{ seq: 1 }, { seq: 5 }] },
    { items: [{ seq: 2 }, { seq: 9 }] },
  ]);
  assert.deepEqual(paths(result), ["/items/*/seq:counter"]);
});

test("numeric object keys are NOT generalized — only array indices are", () => {
  const result = learnRules([{ byYear: { 2026: 10 } }, { byYear: { 2026: 11 } }]);
  assert.deepEqual(paths(result), ["/byYear/2026:counter"]);
});

test("siblings that disagree on kind under one generalized path merge to value", () => {
  const result = learnRules([
    { rows: [{ v: 1 }, { v: "x1" }] },
    { rows: [{ v: 2 }, { v: "y2" }] },
  ]);
  assert.deepEqual(paths(result), ["/rows/*/v:value"]);
});

test("a key present in only some runs is a warning, not a rule", () => {
  const result = learnRules([{ a: 1, debug: true }, { a: 1 }]);
  assert.deepEqual(result.rules, []);
  assert.match(result.warnings[0], /key \/debug present in 1 of 2 runs/);
});

test("arrays of different lengths warn but still learn from the shared prefix", () => {
  const result = learnRules([
    { items: [{ seq: 1 }, { seq: 2 }] },
    { items: [{ seq: 3 }] },
  ]);
  assert.deepEqual(paths(result), ["/items/*/seq:counter"]);
  assert.match(result.warnings[0], /array \/items has lengths 2, 1/);
});

test("a leaf in one run vs an object in another is a structural warning", () => {
  const result = learnRules([{ meta: null }, { meta: { flag: 1 } }]);
  assert.deepEqual(result.rules, []);
  assert.match(result.warnings[0], /\/meta is leaf vs object/);
});

test("three runs: a field that moves in ANY run is learned", () => {
  const result = learnRules([
    { seq: 1, name: "Ada" },
    { seq: 1, name: "Ada" },
    { seq: 2, name: "Ada" },
  ]);
  assert.deepEqual(paths(result), ["/seq:counter"]);
});

test("classifyVariance covers the mixed-type fallback", () => {
  assert.equal(classifyVariance([1, "one"]), "value");
  assert.equal(classifyVariance([true, false]), "value");
});

test("learned rules actually neutralize the variance they came from", () => {
  const runs = [
    { seq: 101, etag: "9e107d9d372bb6826bd81d3542a419d6", total: 3 },
    { seq: 102, etag: "e4d909c290d0fb1ca068ffaddf22cbd0", total: 3 },
  ];
  const { rules } = learnRules(runs);
  const a = maskDocument(runs[0], rules).masked;
  const b = maskDocument(runs[1], rules).masked;
  assert.deepEqual(a, b); // the whole point of the tool, in one assertion
});

test("mergeRules dedupes by path (existing wins) and rules stay sorted", () => {
  const existing = [{ path: "/seq", kind: "counter", source: "variance" }];
  const learned = [
    { path: "/seq", kind: "value", source: "variance" },
    { path: "/etag", kind: "hex-digest", source: "variance" },
  ];
  assert.deepEqual(
    mergeRules(existing, learned).map((r) => `${r.path}:${r.kind}`),
    ["/etag:hex-digest", "/seq:counter"],
  );
  const sorted = learnRules([{ z: 1, a: 2, m: 3 }, { z: 9, a: 8, m: 7 }]);
  assert.deepEqual(sorted.rules.map((r) => r.path), ["/a", "/m", "/z"]);
});
