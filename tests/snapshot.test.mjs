// The snapshot store: deterministic serialization, strict validation
// of the versioned format, and filesystem round-trips in temp dirs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  listSnapshots,
  parseSnapshot,
  readSnapshot,
  serializeSnapshot,
  snapshotPath,
  validateName,
  writeSnapshot,
} from "../dist/index.js";
import { workspace } from "./helpers.mjs";

const SNAP = {
  snapmask: 1,
  name: "orders",
  rules: [{ path: "/seq", kind: "counter", source: "variance" }],
  masked: { seq: "<counter:1>", total: 3 },
};

test("write → read round-trips the snapshot; a missing name reads as null", () => {
  const dir = join(workspace(), "__snapmasks__");
  assert.equal(writeSnapshot(dir, SNAP), "written");
  assert.deepEqual(readSnapshot(dir, "orders"), SNAP);
  assert.equal(readSnapshot(dir, "ghost"), null);
});

test("serialization is canonical and rewrites of identical content report unchanged", () => {
  const dir = join(workspace(), "__snapmasks__");
  writeSnapshot(dir, SNAP);
  const before = readFileSync(snapshotPath(dir, "orders"), "utf8");
  assert.equal(writeSnapshot(dir, SNAP), "unchanged");
  assert.equal(readFileSync(snapshotPath(dir, "orders"), "utf8"), before);
  const a = serializeSnapshot(SNAP);
  const b = serializeSnapshot({ ...SNAP, masked: { total: 3, seq: "<counter:1>" } });
  assert.equal(a, b); // key order in memory never changes the bytes
  assert.ok(a.endsWith("\n"));
});

test("parseSnapshot rejects unknown format versions loudly", () => {
  assert.throws(
    () => parseSnapshot('{"snapmask": 2, "name": "x", "rules": [], "masked": {}}', "f"),
    /unsupported snapshot format/,
  );
});

test("parseSnapshot rejects malformed rules: bad pointer, kind, source", () => {
  const base = (rule) =>
    JSON.stringify({ snapmask: 1, name: "x", rules: [rule], masked: {} });
  assert.throws(
    () => parseSnapshot(base({ path: "no-slash", kind: "counter", source: "variance" }), "f"),
    /invalid JSON Pointer/,
  );
  assert.throws(
    () => parseSnapshot(base({ path: "/a", kind: "wibble", source: "variance" }), "f"),
    /unknown kind/,
  );
  assert.throws(
    () => parseSnapshot(base({ path: "/a", kind: "counter", source: "psychic" }), "f"),
    /unknown source/,
  );
});

test("parseSnapshot rejects non-JSON, non-object and incomplete payloads", () => {
  assert.throws(() => parseSnapshot("{oops", "f"), /not valid JSON/);
  assert.throws(() => parseSnapshot("[1]", "f"), /expected a snapshot object/);
  assert.throws(
    () => parseSnapshot('{"snapmask":1,"name":"x","rules":[]}', "f"),
    /missing "masked"/,
  );
});

test("snapshot names are validated as safe filenames", () => {
  validateName("orders-v2.api");
  assert.throws(() => validateName("../escape"), /invalid snapshot name/);
  assert.throws(() => validateName(""), /invalid snapshot name/);
  assert.throws(() => validateName("a b"), /invalid snapshot name/);
});

test("listSnapshots returns sorted names and [] for a missing dir", () => {
  const dir = join(workspace(), "__snapmasks__");
  assert.deepEqual(listSnapshots(dir), []);
  writeSnapshot(dir, { ...SNAP, name: "zeta" });
  writeSnapshot(dir, { ...SNAP, name: "alpha" });
  assert.deepEqual(listSnapshots(dir), ["alpha", "zeta"]);
});
