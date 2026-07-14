/**
 * JSON Pointer (RFC 6901) helpers, plus the one extension snapmask
 * needs: a `*` segment in a *rule* pointer matches exactly one segment
 * of the concrete pointer (used to generalize over array indices).
 */

import type { JsonValue } from "./types.js";

/** Escape one pointer segment (`~` → `~0`, `/` → `~1`). */
export function escapeSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Unescape one pointer segment. Order matters: `~1` first, then `~0`. */
export function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Format a segment list as a pointer string. The root is `""`. */
export function formatPointer(segments: readonly string[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.map(escapeSegment).join("/");
}

/** Parse a pointer string into segments. Throws on malformed input. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON Pointer (must start with "/"): ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split("/").map(unescapeSegment);
}

/** Read the value at a pointer, or `undefined` if the path is absent. */
export function getAtPointer(doc: JsonValue, segments: readonly string[]): JsonValue | undefined {
  let current: JsonValue = doc;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
      const idx = Number(segment);
      if (idx >= current.length) return undefined;
      current = current[idx] as JsonValue;
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = current[segment] as JsonValue;
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Does a rule pointer (segments possibly containing `*`) match a
 * concrete pointer? `*` matches exactly one segment; lengths must agree.
 */
export function pointerMatches(
  rule: readonly string[],
  concrete: readonly string[],
): boolean {
  if (rule.length !== concrete.length) return false;
  for (let i = 0; i < rule.length; i++) {
    if (rule[i] !== "*" && rule[i] !== concrete[i]) return false;
  }
  return true;
}

/**
 * Generalize a concrete pointer for rule storage: every array-index
 * segment becomes `*`, so a rule learned at `/items/3/id` also covers
 * `/items/0/id` in the next run. `arrayFlags[i]` says whether segment
 * `i` indexes an array (a numeric *object key* is left alone).
 */
export function generalizePointer(
  segments: readonly string[],
  arrayFlags: readonly boolean[],
): string[] {
  return segments.map((segment, i) => (arrayFlags[i] ? "*" : segment));
}
