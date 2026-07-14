# Detection and masking semantics

This document pins down exactly when snapmask masks a value, how
tokens are formed, and what the snapshot file contains. It is the
contract behind every committed snapshot; changes here are breaking
changes for downstream snapshot suites.

## The two tiers

Every JSON leaf (string or number) runs through the shape detectors.
A detection carries a **confidence**:

- **confident** — the format is volatile *by construction*. It embeds
  time, randomness or a signature, so masking it can never hide a
  meaningful business value. Confident detections mask immediately.
- **candidate** — the shape is suggestive but ambiguous. A 10-digit
  integer might be an epoch or a row count; a 64-char hex string might
  be a per-request digest or a stable content address. Candidates are
  reported by `mask --explain` but are **never masked on shape alone**.
  They mask only when a rule targets their path — learned from
  cross-run variance, or added manually to the snapshot file.

This split is the core design decision. Masking on a guess makes a
snapshot weaker in the exact place it looks strongest; snapmask
prefers a failing check plus an explain line over silent acceptance.

## Confident shapes

| Kind | Accepted form |
|---|---|
| `uuid` | RFC 4122, versions 1–8, canonical variant, either case |
| `ulid` | 26 Crockford base32 chars, upper-case, first char `0-7` |
| `objectid` | exactly 24 lower-case hex chars |
| `jwt` | `eyJ…`​`.eyJ…`​`.signature` (header and payload are base64url JSON objects) |
| `timestamp-iso` | ISO 8601 date-**time**: `T`/`t`/space separator, optional fraction, optional `Z`/offset; month/day/hour/minute plausibility-checked; leap second `:60` allowed |
| `timestamp-http` | RFC 7231 IMF-fixdate, `GMT` required |

Deliberate exclusions:

- **Bare dates** (`2019-03-01`) are data — birthdays, release dates,
  billing periods. Never masked.
- **Implausible date-times** (month 13, day 32, hour 24) are strings
  that merely resemble timestamps. Never masked.
- **All-digit strings of digest length** are IDs, not hex digests: the
  hex detector requires at least one `a-f`.

## Candidate shapes

| Kind | Accepted form |
|---|---|
| `epoch-seconds` | integer in `[1000000000, 4102444800)` — 2001-09-09 to 2100-01-01 |
| `epoch-millis` | integer in `[1000000000000, 4102444800000)` |
| `hex-digest` | 32 / 40 / 64 / 128 hex chars (md5/sha1/sha256/sha512), ≥1 letter |
| `duration` | `\d+(\.\d+)?(ns|us|µs|ms|s|m|h)` |

## Variance learning

`learnRules(runs)` (CLI: `snapmask learn`, or extra inputs to `snap`)
canonicalizes all runs and walks them in parallel:

- A leaf whose value differs across runs becomes a rule. Its kind is
  the agreed candidate detection if there is one (`epoch-seconds`,
  `hex-digest`, …), else `counter` (all integers), `number` (numeric),
  `token` (strings sharing a shape signature: charset + length
  bucket), or the honest fallback `value`.
- Leaves whose values are **confidently** detected in every run are
  skipped — shape masking already covers them.
- Array-index path segments generalize to `*` (`/items/3/id` →
  `/items/*/id`); numeric **object keys** are left concrete. Concrete
  siblings that land on one generalized path must agree on kind, else
  the rule kind degrades to `value`.
- **Structural differences never become rules**: a key present in only
  some runs, arrays of different lengths, a leaf vs an object. These
  are returned as warnings, because masking cannot make two different
  shapes equal — hiding that would defeat the snapshot.

## Tokens and referential identity

Masked values become `<kind:N>`. `N` is assigned per kind in
first-occurrence order over the canonical (sorted-key) walk, and equal
source values share a token. Consequences:

- The same UUID appearing at `/customer/id` and `/items/0/ownerId`
  masks to `<uuid:1>` in both places — the snapshot still asserts the
  reference, not the random value.
- If a fresh run breaks that identity (the owner is suddenly a
  different, equally valid UUID), the masked documents differ and
  `check` fails. This is intentional.
- Alias numbers depend on first-occurrence order; if a *new* volatile
  value appears earlier in the document than an old one, numbering
  shifts and the diff shows it. Re-record with `snap` to accept.

## Snapshot file format

`__snapmasks__/<name>.snap.json`, canonical JSON (sorted keys,
two-space indent, trailing newline):

```json
{
  "masked": { "seq": "<counter:1>", "total": 2980 },
  "name": "orders",
  "rules": [
    { "kind": "counter", "path": "/seq", "source": "variance" }
  ],
  "snapmask": 1
}
```

- `snapmask: 1` is the format version; readers reject anything else.
- `rules[].source` records provenance: `shape` (reserved), `variance`
  (learned), `manual` (edited by hand — supported and validated).
- `check` re-applies exactly `rules` + confident shape detection, so
  the masking that guards a snapshot is stored beside it and reviewed
  in the same diff.

## Canonical form

Object keys are sorted recursively and `-0` normalizes to `0` before
masking, diffing or serialization. Key order is therefore never part
of the contract; **array order always is** (a swap is two changes).
