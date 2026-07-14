# Contributing to snapmask

Issues, discussions and pull requests are all welcome — this project
aims to stay small, zero-dependency at runtime, fully offline and
honest about what it can and cannot prove volatile.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/snapmask.git
cd snapmask
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 89 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (the learn → snap → check
workflow, volatile-churn-vs-real-drift separation, `--update`,
`--explain`, JSON determinism and every exit code) against the
committed example capture pair and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (detectors, masker, learner and differ take data and
   return data — only `cli.ts` touches the filesystem or the process).
5. Anything that changes what gets masked or how tokens are numbered —
   a new detector, a regex widening, canonicalization tweaks — is a
   **breaking change for every committed snapshot in every downstream
   repo**. Say so in the PR, update
   [docs/detection.md](docs/detection.md), and expect it to wait for
   a minor release.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually
  be declined. The detectors and the diff are in-repo on purpose.
- No network calls, ever — snapmask masks and diffs local JSON. A
  snapshot tool must run in CI without secrets.
- Determinism is API: same inputs, byte-identical snapshots, report
  order and exit code — no clocks, no randomness, no locale-dependent
  sorting.
- Detection stays honest: never mask on an ambiguous shape alone.
  A candidate needs cross-run variance (or an explicit rule) before
  it masks; structural differences are warnings, not rules.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `snapmask --version` output, the exact command line,
and a *minimal* pair of run files that reproduces the problem — a
value that is masked but should not be, a volatile field that slips
through, or a diff that reads wrongly. The files under
`examples/orders-api/` are a good template for a self-contained repro.

## Security

Do not open public issues for security problems (e.g. a crafted
snapshot name or rule path that escapes the snapshot directory, or a
malicious snapshot file that corrupts state on `check --update`); use
GitHub private vulnerability reporting on this repository instead.
