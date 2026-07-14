// Report formatting: pure string builders behind the CLI's output.
import test from "node:test";
import assert from "node:assert/strict";

import {
  maskSummary,
  renderCheckFailure,
  renderCheckSuccess,
  renderDiffEntry,
  renderExplain,
  renderLearn,
  renderValue,
} from "../dist/index.js";

test("renderValue truncates long values and marks absent ones", () => {
  assert.equal(renderValue("short"), '"short"');
  assert.equal(renderValue(undefined), "(absent)");
  const long = renderValue("x".repeat(200));
  assert.ok(long.length <= 64 && long.endsWith("…"));
});

test("diff entries render as ~ / + / - lines, with / standing in for the root", () => {
  assert.equal(
    renderDiffEntry({ path: "/total", type: "changed", before: 3, after: 4 }),
    "  ~ /total: 3 → 4",
  );
  assert.equal(
    renderDiffEntry({ path: "/fresh", type: "added", after: true }),
    "  + /fresh: added true",
  );
  assert.equal(
    renderDiffEntry({ path: "/gone", type: "removed", before: null }),
    "  - /gone: removed null",
  );
  assert.match(renderDiffEntry({ path: "", type: "changed", before: 1, after: 2 }), /~ \/:/);
});

test("maskSummary breaks fields down by source and pluralizes correctly", () => {
  const field = (source) => ({ path: "/x", kind: "uuid", source, token: "<uuid:1>" });
  assert.equal(maskSummary([]), "0 fields masked");
  assert.equal(maskSummary([field("shape")]), "1 field masked (1 shape)");
  assert.equal(
    maskSummary([field("shape"), field("shape"), field("variance")]),
    "3 fields masked (2 shape · 1 variance)",
  );
});

test("check reports success and failure with actionable hints", () => {
  assert.match(renderCheckSuccess("orders", []), /✓ orders — matches snapshot/);
  const failure = renderCheckFailure("orders", [
    { path: "/total", type: "changed", before: 3, after: 4 },
  ]);
  assert.match(failure, /✗ orders — 1 difference after masking/);
  assert.match(failure, /--update/);
});

test("explain lists masked fields in aligned columns plus unmasked candidates", () => {
  const out = renderExplain(
    [
      { path: "/id", kind: "uuid", source: "shape", token: "<uuid:1>" },
      { path: "/items/0/seq", kind: "counter", source: "variance", token: "<counter:1>" },
    ],
    [{ path: "/etag", kind: "hex-digest" }],
  );
  assert.match(out, /masked 2 fields:/);
  assert.match(out, /\/id\s+uuid\s+shape\s+<uuid:1>/);
  assert.match(out, /candidates .*confirm with `snapmask learn`/);
  assert.match(out, /\/etag\s+hex-digest/);
});

test("explain on a fully-stable document says so", () => {
  assert.match(renderExplain([], []), /nothing in this document looks volatile/);
});

test("learn output lists rules, appends warnings, and explains an empty result", () => {
  const out = renderLearn(
    {
      rules: [{ path: "/seq", kind: "counter", source: "variance" }],
      warnings: ["structural: key /debug present in 1 of 2 runs"],
    },
    2,
  );
  assert.match(out, /learned 1 rule from 2 runs:/);
  assert.match(out, /\/seq\s+counter/);
  assert.match(out, /warning: structural: key \/debug .* masking cannot make these runs equal/);
  assert.match(renderLearn({ rules: [], warnings: [] }, 3), /already equivalent after shape masking/);
});
