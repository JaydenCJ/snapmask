// Shape detectors: what counts as confidently volatile (UUIDs,
// timestamps, …), what is merely a candidate (epochs, digests), and —
// just as important — what plain data must NOT be flagged.
import test from "node:test";
import assert from "node:assert/strict";

import {
  detectNumber,
  detectString,
  detectValue,
  shapeSignature,
} from "../dist/index.js";

function kind(value) {
  const d = detectValue(value);
  return d ? `${d.kind}/${d.confidence}` : null;
}

test("RFC 4122 UUIDs of any version and either case are confident", () => {
  assert.equal(kind("a3bb189e-8bf9-4c8b-9c4b-1a2b3c4d5e6f"), "uuid/confident"); // v4
  assert.equal(kind("017f22e2-79b0-7cc3-98c4-dc0c0c07398f"), "uuid/confident"); // v7
  assert.equal(kind("2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d"), "uuid/confident"); // v1
  assert.equal(kind("A3BB189E-8BF9-4C8B-9C4B-1A2B3C4D5E6F"), "uuid/confident");
});

test("near-UUIDs are rejected: bad variant, bad version, missing dashes", () => {
  assert.equal(kind("a3bb189e-8bf9-4c8b-1c4b-1a2b3c4d5e6f"), null); // variant nibble 1
  assert.equal(kind("a3bb189e-8bf9-0c8b-9c4b-1a2b3c4d5e6f"), null); // version 0
  assert.equal(kind("a3bb189e8bf94c8b9c4b1a2b3c4d5e6f"), "hex-digest/candidate"); // 32 hex
});

test("ULIDs are confident; lowercase and I/L/O/U alphabet violations are not ULIDs", () => {
  assert.equal(kind("01ARZ3NDEKTSV4RRFFQ69G5FAV"), "ulid/confident");
  assert.equal(kind("01arz3ndektsv4rrffq69g5fav"), null);
  assert.equal(kind("01ARZ3NDEKTSV4RRFFQ69G5FAI"), null); // "I" is not Crockford
});

test("MongoDB ObjectIds (24 lowercase hex) are confident", () => {
  assert.equal(kind("507f1f77bcf86cd799439011"), "objectid/confident");
  assert.equal(kind("507F1F77BCF86CD799439011"), null); // ObjectIds are lowercase
});

test("JWTs are confident: three base64url parts, header and payload start eyJ", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ." +
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  assert.equal(kind(jwt), "jwt/confident");
  assert.equal(kind("eyJhbGciOiJIUzI1NiJ9.not-eyJ.sig"), null);
});

test("ISO 8601 date-times are confident in Z, offset, space, fractional and leap-second forms", () => {
  assert.equal(kind("2026-07-13T08:15:30Z"), "timestamp-iso/confident");
  assert.equal(kind("2026-07-13T08:15:30.123456+09:00"), "timestamp-iso/confident");
  assert.equal(kind("2026-07-13 08:15:30"), "timestamp-iso/confident");
  assert.equal(kind("2026-07-13t08:15:30z"), "timestamp-iso/confident");
  assert.equal(kind("2026-06-30T23:59:60Z"), "timestamp-iso/confident"); // leap second
});

test("bare dates and implausible date-times are NOT masked", () => {
  assert.equal(kind("2026-07-13"), null); // birthdays and release dates are data
  assert.equal(kind("2026-13-01T08:15:30Z"), null); // month 13
  assert.equal(kind("2026-07-32T08:15:30Z"), null); // day 32
  assert.equal(kind("2026-07-13T24:15:30Z"), null); // hour 24
});

test("HTTP IMF-fixdate (Date / Last-Modified headers) is confident and must say GMT", () => {
  assert.equal(kind("Sun, 13 Jul 2026 08:15:30 GMT"), "timestamp-http/confident");
  assert.equal(kind("Sun, 13 Jul 2026 08:15:30 UTC"), null);
});

test("hex digests are candidates at md5/sha1/sha256/sha512 lengths only, never all-digit", () => {
  assert.equal(kind("9e107d9d372bb6826bd81d3542a419d6"), "hex-digest/candidate"); // 32
  assert.equal(kind("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12"), "hex-digest/candidate"); // 40
  assert.equal(kind("d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"), "hex-digest/candidate"); // 64
  assert.equal(kind("9e107d9d372bb6826bd81d3542a419d6ab"), null); // 34: no digest is 34 hex
  assert.equal(kind("1".repeat(32)), null); // an all-digit "digest" is an ID
});

test("durations are candidates; bare numbers-with-words are not", () => {
  assert.equal(kind("12ms"), "duration/candidate");
  assert.equal(kind("1.5s"), "duration/candidate");
  assert.equal(kind("250us"), "duration/candidate");
  assert.equal(kind("12 ms"), null);
  assert.equal(kind("fast"), null);
});

test("integers in plausible epoch ranges are candidates; everything else stays unflagged", () => {
  assert.equal(kind(1752394530), "epoch-seconds/candidate");
  assert.equal(kind(1752394530123), "epoch-millis/candidate");
  assert.equal(detectNumber(1752394530)?.confidence, "candidate"); // never confident
  assert.equal(kind(999_999_999), null); // below 2001-09-09
  assert.equal(kind(4_102_444_800), null); // 2100-01-01 and later: not plausible
  assert.equal(kind(42), null);
  assert.equal(kind(1752394530.5), null); // floats never look like epochs
});

test("plain business data survives: names, emails, SKUs, short hex, primitives, containers", () => {
  assert.equal(kind("Ada Lovelace"), null);
  assert.equal(kind("ada@example.test"), null);
  assert.equal(kind("WIDGET-9"), null);
  assert.equal(kind("cafe"), null); // 4 hex chars, but no digest is 4 long
  assert.equal(detectString(""), null);
  assert.equal(detectValue(true), null);
  assert.equal(detectValue(null), null);
  assert.equal(detectValue([1, 2]), null);
  assert.equal(detectValue({ a: 1 }), null);
});

test("shapeSignature groups same-shape random tokens and separates prose", () => {
  assert.equal(shapeSignature("9f86d081884c7d65"), shapeSignature("2c26b46b68ffc68f"));
  assert.notEqual(shapeSignature("9f86d081884c7d65"), shapeSignature("a plain sentence"));
  assert.equal(shapeSignature("12345678").startsWith("digits:"), true);
  // Length buckets absorb small wiggle in long ids.
  assert.equal(shapeSignature("a".repeat(23)), shapeSignature("b".repeat(25)));
});
