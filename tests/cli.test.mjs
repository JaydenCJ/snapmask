// CLI integration: snap → check → drift → update end to end via the
// built binary, plus exit codes, stdin, JSON output and error handling.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, ordersRun, runCli, workspace } from "./helpers.mjs";

function ordersWorkspace() {
  return workspace({
    "run1.json": ordersRun(0),
    "run2.json": ordersRun(1),
    "run3.json": ordersRun(2),
  });
}

test("--version prints the package.json version; --help documents commands and exit codes", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const version = runCli(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  for (const word of ["snap", "check", "mask", "learn", "ls", "--update", "--explain", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `--help missing ${word}`);
  }
  assert.equal(runCli([]).status, 2); // bare invocation is a usage error
});

test("unknown commands and unknown flags exit 2 with a message on stderr", () => {
  const bad = runCli(["frobnicate"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown command: frobnicate/);
  const typo = runCli(["check", "run.json", "--updaet"]);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown flag: --updaet/);
});

test("missing files, invalid JSON and unnamed stdin exit 2 with the problem named", () => {
  const dir = workspace({ "bad.json": "{nope" });
  const missing = runCli(["snap", "ghost.json"], dir);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file: ghost\.json/);
  const invalid = runCli(["snap", "bad.json"], dir);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /bad\.json: not valid JSON/);
  const unnamed = runCli(["snap", "-"], dir, "{}");
  assert.equal(unnamed.status, 2);
  assert.match(unnamed.stderr, /--name is required when reading from stdin/);
});

test("snap defaults the name to the input basename and writes the store", () => {
  const dir = ordersWorkspace();
  const { status, stdout } = runCli(["snap", "run1.json"], dir);
  assert.equal(status, 0);
  assert.match(stdout, /✓ run1 → __snapmasks__\/run1\.snap\.json \(written\)/);
  assert.ok(existsSync(join(dir, "__snapmasks__", "run1.snap.json")));
});

test("snap with two runs learns variance rules and stores them in the snapshot", () => {
  const dir = ordersWorkspace();
  const { status, stdout } = runCli(
    ["snap", "run1.json", "run2.json", "--name", "orders"],
    dir,
  );
  assert.equal(status, 0);
  assert.match(stdout, /2 rules learned from 2 runs/);
  const snap = JSON.parse(readFileSync(join(dir, "__snapmasks__", "orders.snap.json"), "utf8"));
  assert.deepEqual(
    snap.rules.map((r) => `${r.path}:${r.kind}`),
    ["/etag:hex-digest", "/seq:counter"],
  );
});

test("check passes on a THIRD run never seen during learning", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  const { status, stdout } = runCli(["check", "run3.json", "--name", "orders"], dir);
  assert.equal(status, 0);
  assert.match(stdout, /✓ orders — matches snapshot/);
});

test("check fails with exit 1 and a pointer-level diff on a real change", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  const tampered = { ...ordersRun(2), total: 99 };
  const run = runCli(["check", "-", "--name", "orders"], dir, JSON.stringify(tampered));
  assert.equal(run.status, 1);
  assert.match(run.stdout, /✗ orders — 1 difference after masking/);
  assert.match(run.stdout, /~ \/total: 3 → 99/);
});

test("volatile churn alone never fails check; broken references do", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  // Break referential consistency: items[1] suddenly owned by someone
  // else. Every id is still a valid UUID — only the aliasing differs.
  const drifted = ordersRun(2);
  drifted.items[1].ownerId = "550e8400-e29b-41d4-a716-446655440000";
  const run = runCli(["check", "-", "--name", "orders"], dir, JSON.stringify(drifted));
  assert.equal(run.status, 1);
  assert.match(run.stdout, /\/items\/1\/ownerId: "<uuid:\d>" → "<uuid:\d>"/);
});

test("check --update accepts drift and the next check passes", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  const changed = { ...ordersRun(2), total: 4 };
  const update = runCli(
    ["check", "-", "--name", "orders", "--update"],
    dir,
    JSON.stringify(changed),
  );
  assert.equal(update.status, 0);
  assert.match(update.stdout, /snapshot updated \(1 accepted difference\)/);
  const again = runCli(["check", "-", "--name", "orders"], dir, JSON.stringify(changed));
  assert.equal(again.status, 0);
  // With --json, the update confirmation stays machine-readable.
  const changedMore = { ...ordersRun(2), total: 5 };
  const jsonUpdate = runCli(
    ["check", "-", "--name", "orders", "--update", "--json"],
    dir,
    JSON.stringify(changedMore),
  );
  assert.equal(jsonUpdate.status, 0);
  const payload = JSON.parse(jsonUpdate.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.updated, true);
  assert.deepEqual(payload.differences.map((d) => d.path), ["/total"]);
});

test("check --json is valid, machine-readable and deterministic", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  const tampered = JSON.stringify({ ...ordersRun(2), total: 99 });
  const a = runCli(["check", "-", "--name", "orders", "--json"], dir, tampered);
  const b = runCli(["check", "-", "--name", "orders", "--json"], dir, tampered);
  assert.equal(a.status, 1);
  assert.equal(a.stdout, b.stdout);
  const payload = JSON.parse(a.stdout);
  assert.equal(payload.tool, "snapmask");
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.differences, [
    { path: "/total", type: "changed", before: 3, after: 99 },
  ]);
});

test("check against a missing snapshot exits 2 and says how to record one", () => {
  const dir = ordersWorkspace();
  const run = runCli(["check", "run1.json", "--name", "ghost"], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no snapshot named "ghost"/);
  assert.match(run.stderr, /snapmask snap/);
});

test("snap re-recorded from a single run keeps previously learned rules", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  runCli(["snap", "run3.json", "--name", "orders"], dir);
  const snap = JSON.parse(readFileSync(join(dir, "__snapmasks__", "orders.snap.json"), "utf8"));
  assert.equal(snap.rules.length, 2);
  const { status } = runCli(["check", "run1.json", "--name", "orders"], dir);
  assert.equal(status, 0);
});

test("mask prints canonical masked JSON to stdout, shape-only by default", () => {
  const dir = ordersWorkspace();
  const { status, stdout } = runCli(["mask", "run1.json"], dir);
  assert.equal(status, 0);
  const masked = JSON.parse(stdout);
  assert.equal(masked.requestId, "<uuid:2>"); // customer id sorts first
  assert.equal(masked.servedAt, "<timestamp-iso:1>");
  assert.equal(masked.seq, 101); // candidate: not masked without a rule
});

test("mask --name applies the snapshot's learned rules on top of shapes", () => {
  const dir = ordersWorkspace();
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  const { stdout } = runCli(["mask", "run3.json", "--name", "orders"], dir);
  const masked = JSON.parse(stdout);
  assert.equal(masked.seq, "<counter:1>");
  assert.equal(masked.etag, "<hex-digest:1>");
});

test("mask --explain reports every masked field and the unmasked candidates", () => {
  const dir = ordersWorkspace();
  const { status, stdout } = runCli(["mask", "run1.json", "--explain"], dir);
  assert.equal(status, 0);
  assert.match(stdout, /masked 5 fields:/);
  assert.match(stdout, /\/requestId\s+uuid\s+shape/);
  assert.match(stdout, /candidates/);
  assert.match(stdout, /\/etag\s+hex-digest/);
});

test("learn prints rules as text and as JSON", () => {
  const dir = ordersWorkspace();
  const text = runCli(["learn", "run1.json", "run2.json"], dir);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /learned 2 rules from 2 runs:/);
  const json = runCli(["learn", "run1.json", "run2.json", "--json"], dir);
  const payload = JSON.parse(json.stdout);
  assert.deepEqual(payload.warnings, []);
  assert.deepEqual(
    payload.rules.map((r) => r.path),
    ["/etag", "/seq"],
  );
});

test("learn with one input exits 2; structural warnings go to snap's stderr", () => {
  const dir = workspace({
    "a.json": { v: 1, extra: true },
    "b.json": { v: 2 },
  });
  const one = runCli(["learn", "a.json"], dir);
  assert.equal(one.status, 2);
  assert.match(one.stderr, /at least 2 input files/);
  const snap = runCli(["snap", "a.json", "b.json", "--name", "pair"], dir);
  assert.equal(snap.status, 0);
  assert.match(snap.stderr, /warning: structural: key \/extra present in 1 of 2 runs/);
});

test("ls lists snapshots with rule provenance; --dir relocates the store everywhere", () => {
  const dir = ordersWorkspace();
  const empty = runCli(["ls"], dir);
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /no snapshots in __snapmasks__/);
  runCli(["snap", "run1.json", "run2.json", "--name", "orders"], dir);
  runCli(["snap", "run1.json", "--name", "plain"], dir);
  const listed = runCli(["ls"], dir);
  assert.match(listed.stdout, /orders — 2 rules \(2 learned\)/);
  assert.match(listed.stdout, /plain — shape masking only/);
  runCli(["snap", "run1.json", "--name", "orders", "--dir", "snaps"], dir);
  assert.ok(existsSync(join(dir, "snaps", "orders.snap.json")));
  assert.equal(runCli(["check", "run1.json", "--name", "orders", "--dir", "snaps"], dir).status, 0);
  assert.match(runCli(["ls", "--dir", "snaps"], dir).stdout, /orders/);
});

test("the committed example suite passes check as shipped", () => {
  const example = join(ROOT, "examples", "orders-api");
  const run = runCli(
    ["check", join(example, "run2.json"), "--name", "orders", "--dir", join(example, "__snapmasks__")],
  );
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
