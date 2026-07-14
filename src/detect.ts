/**
 * Shape detectors: classify a single JSON leaf value by what it looks
 * like, with an explicit confidence tier.
 *
 * Confident kinds are volatile by construction — UUIDs, ULIDs and
 * ObjectIds embed randomness and/or time, JWTs embed `iat`/`exp` and a
 * signature, timestamps are timestamps. They are masked on shape alone.
 *
 * Candidate kinds are suggestive but ambiguous — a 10-digit integer
 * may be an epoch or a row count; a 64-char hex string may be a
 * request digest or a stable content hash. Masking them on shape alone
 * would quietly weaken snapshots, so they are only masked once
 * cross-run variance (see variance.ts) confirms the field moves.
 */

import type { Detection } from "./types.js";

// --- Confident string shapes -------------------------------------------

// RFC 4122 UUID, any version 1-8, canonical variant. Case-insensitive.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ULID: 26 chars of Crockford base32, canonically upper-case; the first
// char is 0-7 because the 48-bit timestamp cannot overflow 26 chars.
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// MongoDB ObjectId: exactly 24 lowercase hex chars (4-byte timestamp +
// 5-byte random + 3-byte counter — volatile three ways at once).
const OBJECTID_RE = /^[0-9a-f]{24}$/;

// JWT: three base64url segments; header and payload are JSON objects,
// so both start with base64("{\"") = "eyJ".
const JWT_RE = /^eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+$/;

// ISO 8601 date-time (a bare date like "2001-04-01" is NOT matched —
// birthdays and release dates are data, not noise).
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|z|[+-]\d{2}:?\d{2})?$/;

// RFC 7231 IMF-fixdate, as sent in HTTP Date / Last-Modified headers.
const HTTP_DATE_RE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

// --- Candidate shapes ---------------------------------------------------

// Hex digest lengths for md5/sha1/sha256/sha512. Requires at least one
// a-f so a long decimal ID is not mistaken for hex.
const HEX_DIGEST_RE = /^(?=.*[a-f])[0-9a-f]{32}$|^(?=.*[a-f])[0-9a-f]{40}$|^(?=.*[a-f])[0-9a-f]{64}$|^(?=.*[a-f])[0-9a-f]{128}$/i;

// Human-readable duration: "12ms", "1.5s", "250us", "3m".
const DURATION_RE = /^\d+(\.\d+)?(ns|us|µs|ms|s|m|h)$/;

// Plausible epoch ranges: 2001-09-09 .. 2100-01-01, in seconds / millis.
const EPOCH_S_MIN = 1_000_000_000;
const EPOCH_S_MAX = 4_102_444_800;
const EPOCH_MS_MIN = 1_000_000_000_000;
const EPOCH_MS_MAX = 4_102_444_800_000;

/** Days per month; ISO validation ignores leap years on purpose (a
 * Feb 29 in a non-leap year still *looks like* a timestamp). */
const MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isPlausibleIso(m: RegExpMatchArray): boolean {
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > (MAX_DAY[month - 1] ?? 31)) return false;
  // 60 allows leap seconds, which real serializers do emit.
  return hour <= 23 && minute <= 59 && second <= 60;
}

/** Classify a string leaf, or return null when it looks like plain data. */
export function detectString(value: string): Detection | null {
  if (UUID_RE.test(value)) return { kind: "uuid", confidence: "confident" };
  if (ULID_RE.test(value)) return { kind: "ulid", confidence: "confident" };
  if (JWT_RE.test(value)) return { kind: "jwt", confidence: "confident" };
  const iso = value.match(ISO_RE);
  if (iso && isPlausibleIso(iso)) {
    return { kind: "timestamp-iso", confidence: "confident" };
  }
  if (HTTP_DATE_RE.test(value)) {
    return { kind: "timestamp-http", confidence: "confident" };
  }
  // ObjectId before hex-digest: 24 hex chars is an ObjectId, not a
  // truncated digest. Both are checked after the anchored formats.
  if (OBJECTID_RE.test(value)) {
    return { kind: "objectid", confidence: "confident" };
  }
  if (HEX_DIGEST_RE.test(value)) {
    return { kind: "hex-digest", confidence: "candidate" };
  }
  if (DURATION_RE.test(value)) {
    return { kind: "duration", confidence: "candidate" };
  }
  return null;
}

/** Classify a number leaf, or return null when it looks like plain data. */
export function detectNumber(value: number): Detection | null {
  if (!Number.isInteger(value)) return null;
  if (value >= EPOCH_S_MIN && value < EPOCH_S_MAX) {
    return { kind: "epoch-seconds", confidence: "candidate" };
  }
  if (value >= EPOCH_MS_MIN && value < EPOCH_MS_MAX) {
    return { kind: "epoch-millis", confidence: "candidate" };
  }
  return null;
}

/** Classify any JSON leaf. Objects, arrays, booleans and null are never
 * shape-volatile on their own. */
export function detectValue(value: unknown): Detection | null {
  if (typeof value === "string") return detectString(value);
  if (typeof value === "number") return detectNumber(value);
  return null;
}

/**
 * A coarse fingerprint of a string's *shape*, used by variance learning
 * to tell "same field, fresh random value" (hex-16 vs hex-16) apart
 * from "the field means something different now" (hex-16 vs a sentence).
 * Format: `<charset>:<length-bucket>`.
 */
export function shapeSignature(value: string): string {
  let charset: string;
  if (/^[0-9]+$/.test(value)) charset = "digits";
  else if (/^[0-9a-f]+$/i.test(value)) charset = "hex";
  else if (/^[A-Za-z0-9_-]+$/.test(value)) charset = "base64url";
  else if (/^[A-Za-z0-9+/=]+$/.test(value)) charset = "base64";
  else charset = "text";
  // Length buckets absorb one-or-two char wiggle in variable-width ids.
  const bucket = value.length <= 8 ? String(value.length) : `${Math.round(value.length / 4) * 4}~`;
  return `${charset}:${bucket}`;
}
