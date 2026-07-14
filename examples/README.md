# snapmask examples

A small orders-API capture pair with its snapshot committed, so you
can watch the whole workflow without running a server first. All
commands below run from the repository root after `npm install &&
npm run build`; replace `node dist/cli.js` with `snapmask` if you
installed the package globally.

## Files

- `orders-api/run1.json`, `orders-api/run2.json` — two captures of
  the same (imaginary) `GET /api/orders` response. Between the runs,
  the request UUID, ISO timestamp, sequence counter, etag and page
  cursor all moved; the customer, items, prices and total did not.
  There is also a bare date (`memberSince`) that must NOT be masked.
- `orders-api/__snapmasks__/orders.snap.json` — the committed
  snapshot: the masked document plus the four rules learned from the
  pair (`/etag`, `/pagination/cursor`, `/seq`, `/tookMs`).

## Try it

Both committed runs match the one committed snapshot — that is the
entire point of the tool:

```bash
node dist/cli.js check examples/orders-api/run1.json --name orders --dir examples/orders-api/__snapmasks__
node dist/cli.js check examples/orders-api/run2.json --name orders --dir examples/orders-api/__snapmasks__
```

See why each field was or was not masked:

```bash
node dist/cli.js mask examples/orders-api/run1.json --explain
```

Note that `/etag` shows up as an unmasked *candidate* under
shape-only masking — it is a valid md5, but snapmask will not mask it
on a guess. The learned rule in the snapshot is what masks it:

```bash
node dist/cli.js learn examples/orders-api/run1.json examples/orders-api/run2.json
```

Now break something for real — edit a `qty` or the `total` in a copy
of `run2.json` and run `check` again. The volatile churn stays
invisible; your edit fails with its exact JSON Pointer and exit
code 1. Accept intentional changes with `check --update`, or
re-record (and re-learn) with `snap`.
