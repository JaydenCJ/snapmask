#!/usr/bin/env bash
# Smoke test for snapmask: exercises the real CLI end to end against
# the committed example capture pair. No network, idempotent, runs from
# a clean checkout (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every command.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in snap check mask learn ls --update --explain --dir "Exit codes"; do
  grep -q -- "$word" <<<"$HELP" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. The committed example snapshot matches BOTH committed runs — the
#    volatile fields (request id, timestamp, seq, etag, cursor) differ
#    between the runs, and masking must absorb exactly that.
$CLI check examples/orders-api/run1.json --name orders --dir examples/orders-api/__snapmasks__ >/dev/null \
  || fail "committed run1 should match the committed snapshot"
$CLI check examples/orders-api/run2.json --name orders --dir examples/orders-api/__snapmasks__ >/dev/null \
  || fail "committed run2 should match the committed snapshot"
echo "[smoke] committed examples ok (two runs, one snapshot)"

# 4. Error handling: bad commands, flags and inputs exit 2.
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI check x.json --updaet >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI snap does-not-exist.json >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing input should exit 2"; }
$CLI check examples/orders-api/run1.json --name ghost >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing snapshot should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 5. The flagship workflow in a scratch copy: learn → snap → check.
cp "$ROOT/examples/orders-api/run1.json" "$ROOT/examples/orders-api/run2.json" "$WORKDIR/"
cd "$WORKDIR"
LEARNED="$($CLI learn run1.json run2.json)"
grep -q "/seq" <<<"$LEARNED" || fail "learn should infer a /seq rule"
SNAPPED="$($CLI snap run1.json run2.json --name orders)"
grep -q "rules learned from 2 runs" <<<"$SNAPPED" || fail "snap should learn rules"
[ -f __snapmasks__/orders.snap.json ] || fail "snapshot file should exist"
$CLI check run2.json --name orders >/dev/null || fail "check should pass right after snap"
echo "[smoke] learn → snap → check ok"

# 6. Volatile churn passes; a real regression fails with the pointer.
node -e "
  const fs = require('fs');
  const run = JSON.parse(fs.readFileSync('run2.json', 'utf8'));
  // Fresh volatile values, same business data: must still pass.
  run.requestId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  run.servedAt = '2026-07-13T09:00:00Z';
  run.seq = 999;
  run.etag = 'd41d8cd98f00b204e9800998ecf8427e';
  run.pagination.cursor = 'q2w8e5r1t7y4u9i6';
  fs.writeFileSync('run4.json', JSON.stringify(run));
  run.total = 3141; // and one real regression on top
  fs.writeFileSync('run5.json', JSON.stringify(run));
"
$CLI check run4.json --name orders >/dev/null || fail "pure volatile churn should pass check"
set +e
DRIFT="$($CLI check run5.json --name orders)"; DRIFT_EXIT=$?
set -e
[ "$DRIFT_EXIT" -eq 1 ] || fail "a real change should exit 1, got $DRIFT_EXIT"
grep -qF "~ /total: 2980 → 3141" <<<"$DRIFT" || fail "drift report missing the /total change"
echo "[smoke] volatile-vs-real drift ok (exit 1)"

# 7. --json is valid, deterministic and structurally intact.
set +e
A="$($CLI check run5.json --name orders --json)"
B="$($CLI check run5.json --name orders --json)"
set -e
[ "$A" = "$B" ] || fail "check --json is not deterministic"
echo "$A" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (d.tool !== 'snapmask') throw new Error('tool');
  if (d.ok !== false) throw new Error('ok');
  if (d.differences.length !== 1) throw new Error('differences');
  if (d.differences[0].path !== '/total') throw new Error('path');
  if (!d.rules.some(r => r.path === '/seq' && r.kind === 'counter')) throw new Error('rules');
" || fail "check --json is not structurally intact"
echo "[smoke] --json + determinism ok"

# 8. check --update accepts the regression; the suite is green again.
$CLI check run5.json --name orders --update >/dev/null || fail "check --update should exit 0"
$CLI check run5.json --name orders >/dev/null || fail "check should pass after --update"
echo "[smoke] check --update ok"

# 9. mask works as a pipe filter with stable, aliased tokens.
MASKED="$(cat run1.json | $CLI mask -)"
grep -qF '"requestId": "<uuid:2>"' <<<"$MASKED" || fail "mask should replace the request id"
grep -qF '"servedAt": "<timestamp-iso:1>"' <<<"$MASKED" || fail "mask should replace the timestamp"
[ "$(grep -cF '"ownerId": "<uuid:1>"' <<<"$MASKED")" -eq 2 ] || fail "repeated ids should share one token"
EXPLAINED="$($CLI mask run1.json --explain)"
grep -q "candidates" <<<"$EXPLAINED" || fail "--explain should list unmasked candidates"
echo "[smoke] mask + --explain ok"

# 10. ls reports the store with rule provenance.
LISTED="$($CLI ls)"
grep -qE "orders — 4 rules \(4 learned\)" <<<"$LISTED" || fail "ls should report learned rules"
echo "[smoke] ls ok"

echo "SMOKE OK"
