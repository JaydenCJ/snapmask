# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Shape detectors with explicit confidence tiers: UUIDs (v1–8),
  ULIDs, MongoDB ObjectIds, JWTs, ISO 8601 date-times (with
  plausibility checks and leap-second tolerance) and HTTP IMF-fixdates
  mask on sight; epoch-range integers, hex digests (md5/sha1/sha256/
  sha512 lengths, all-digit strings excluded) and durations are
  candidates that never mask on shape alone.
- Cross-run variance learning: two or more captures of the same
  payload yield mask rules for every field that moved, classified as
  `counter`, `number`, `token` (shape-signature match) or `value`,
  with array indices generalized to `*` and numeric object keys kept
  concrete; structural differences (missing keys, length changes,
  leaf-vs-container) become warnings, never rules.
- Referential token aliasing: masked values become `<kind:N>` with
  equal source values sharing a token, so cross-references between
  masked ids are still asserted by every snapshot.
- Canonical document form (recursively sorted keys, `-0` → `0`) so
  key order never flips a snapshot, while array order stays contract.
- A versioned snapshot store (`__snapmasks__/<name>.snap.json`,
  `"snapmask": 1`) carrying the masked document and its rules with
  provenance (`shape` / `variance` / `manual`), strictly validated on
  read and byte-stable on write.
- Structural diff with JSON Pointer paths, classifying every
  difference as changed, added or removed.
- The `snap` command (record + learn from extra runs, merging with
  previously learned rules), `check` (mask fresh run with stored
  rules, diff, `--update`, `--json`), `mask` (pipe filter,
  `--explain` provenance report), `learn` and `ls`; stdin via `-`;
  exit codes 0/1/2 (clean / mismatch / usage error) for CI gating.
- Public programmatic API (`maskDocument`, `learnRules`,
  `diffDocuments`, `detectValue`, `canonicalize`, snapshot store
  helpers, …) with type declarations, for asserting masked documents
  inside any test runner.
- A committed example capture pair (`examples/orders-api/`) whose one
  snapshot matches both runs as shipped.
- Test suite: 89 node:test tests (unit + CLI integration in temp
  workspaces) and an end-to-end `scripts/smoke.sh` against the
  bundled examples.

[0.1.0]: https://github.com/JaydenCJ/snapmask/releases/tag/v0.1.0
