/**
 * Canonical form for JSON documents.
 *
 * Snapshots must not flip when a server reorders object keys, so every
 * document is canonicalized (keys sorted recursively, `-0` normalized
 * to `0`) before masking, diffing or serializing. Array order is
 * preserved — element order *is* part of an API contract.
 */

import type { JsonObject, JsonValue } from "./types.js";

/** Return a deep copy with object keys sorted recursively. */
export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as JsonObject)[key] as JsonValue);
    }
    return out;
  }
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

/**
 * Serialize a document deterministically: canonical key order,
 * two-space indent, trailing newline. This is the byte format of the
 * `masked` payload inside snapshot files.
 */
export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value), null, 2) + "\n";
}

/** Deep structural equality over JSON values (assumes canonical form
 * is not required — key order is ignored). */
export function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i] as JsonValue));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        deepEqual((a as JsonObject)[key] as JsonValue, (b as JsonObject)[key] as JsonValue),
    );
  }
  return false;
}

/** Parse text as a JSON document, with a friendlier error message. */
export function parseJsonDocument(text: string, label: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: not valid JSON (${detail})`);
  }
}
