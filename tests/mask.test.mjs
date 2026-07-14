// Masking: confident shapes mask on sight, candidates wait for rules,
// tokens are referentially consistent, and everything is deterministic
// under key reordering.
import test from "node:test";
import assert from "node:assert/strict";

import { maskDocument } from "../dist/index.js";

test("confident shapes mask with kind-labelled tokens; plain data is untouched", () => {
  const { masked } = maskDocument({
    id: "a3bb189e-8bf9-4c8b-9c4b-1a2b3c4d5e6f",
    createdAt: "2026-07-13T08:15:30Z",
    name: "Ada Lovelace",
  });
  assert.deepEqual(masked, {
    createdAt: "<timestamp-iso:1>",
    id: "<uuid:1>",
    name: "Ada Lovelace",
  });
});

test("repeated source values reuse their token, numbered per kind — references stay verifiable", () => {
  const uuid = "0b8f8f0e-2f6a-4c8e-9d3b-7a1c2e3f4a5b";
  const other = "550e8400-e29b-41d4-a716-446655440000";
  const { masked } = maskDocument({
    customer: { id: uuid },
    order: { ownerId: uuid, approverId: other, placedAt: "2026-07-13T08:15:30Z" },
  });
  assert.equal(masked.customer.id, "<uuid:1>");
  assert.equal(masked.order.ownerId, "<uuid:1>"); // same entity, same token
  assert.equal(masked.order.approverId, "<uuid:2>");
  assert.equal(masked.order.placedAt, "<timestamp-iso:1>"); // kinds count independently
});

test("candidates (epochs, digests, durations) are NOT masked without a rule", () => {
  const doc = { seq: 1752394530, etag: "9e107d9d372bb6826bd81d3542a419d6", took: "12ms" };
  const { masked, candidates } = maskDocument(doc);
  assert.deepEqual(masked, doc);
  assert.deepEqual(
    candidates.map((c) => `${c.path}:${c.kind}`).sort(),
    ["/etag:hex-digest", "/seq:epoch-seconds", "/took:duration"],
  );
});

test("rules are authoritative — they mask candidates and plain values, reported with provenance", () => {
  const { masked, fields } = maskDocument(
    { seq: 42, note: "hello" },
    [
      { path: "/seq", kind: "counter", source: "variance" },
      { path: "/note", kind: "value", source: "manual" },
    ],
  );
  assert.deepEqual(masked, { note: "<value:1>", seq: "<counter:1>" });
  assert.deepEqual(
    fields.map((f) => [f.path, f.kind, f.source, f.token]).sort(),
    [
      ["/note", "value", "manual", "<value:1>"],
      ["/seq", "counter", "variance", "<counter:1>"],
    ],
  );
});

test("wildcard rules cover every array index", () => {
  const { masked } = maskDocument(
    { items: [{ seq: 1 }, { seq: 2 }, { seq: 1 }] },
    [{ path: "/items/*/seq", kind: "counter", source: "variance" }],
  );
  assert.deepEqual(masked.items, [
    { seq: "<counter:1>" },
    { seq: "<counter:2>" },
    { seq: "<counter:1>" }, // equal source values share a token
  ]);
});

test("a rule matching a subtree replaces the whole subtree with one token", () => {
  const { masked, fields } = maskDocument(
    { debug: { pid: 4242, rss: 1048576 }, ok: true },
    [{ path: "/debug", kind: "value", source: "manual" }],
  );
  assert.deepEqual(masked, { debug: "<value:1>", ok: true });
  assert.equal(fields.length, 1);
  assert.equal(fields[0].path, "/debug");
});

test("masking is deterministic under input key reordering (canonical walk)", () => {
  const uuidA = "a3bb189e-8bf9-4c8b-9c4b-1a2b3c4d5e6f";
  const uuidB = "550e8400-e29b-41d4-a716-446655440000";
  const one = maskDocument({ zebra: uuidA, apple: uuidB });
  const two = maskDocument({ apple: uuidB, zebra: uuidA });
  // Canonical (sorted-key) walk visits "apple" first in both cases.
  assert.deepEqual(one.masked, two.masked);
  assert.equal(one.masked.apple, "<uuid:1>");
  assert.equal(one.masked.zebra, "<uuid:2>");
});

test("confident values inside arrays are masked positionally", () => {
  const { masked } = maskDocument({
    events: ["2026-07-13T08:15:30Z", "stable", "2026-07-13T08:16:00Z"],
  });
  assert.deepEqual(masked.events, ["<timestamp-iso:1>", "stable", "<timestamp-iso:2>"]);
});

test("rules win over shape detection when both target the same leaf", () => {
  const { masked, fields } = maskDocument(
    { at: "2026-07-13T08:15:30Z" },
    [{ path: "/at", kind: "value", source: "manual" }],
  );
  assert.deepEqual(masked, { at: "<value:1>" });
  assert.equal(fields[0].source, "manual");
});

test("stable primitives pass through; empty documents mask to themselves", () => {
  const doc = { on: true, gone: null, count: 12, ratio: 0.5 };
  const { masked, fields, candidates } = maskDocument(doc);
  assert.deepEqual(masked, doc);
  assert.equal(fields.length, 0);
  assert.equal(candidates.length, 0);
  assert.deepEqual(maskDocument({}).masked, {});
});

test("keys needing pointer escapes are reported escaped", () => {
  const { fields } = maskDocument({ "a/b": "a3bb189e-8bf9-4c8b-9c4b-1a2b3c4d5e6f" });
  assert.equal(fields[0].path, "/a~1b");
});
