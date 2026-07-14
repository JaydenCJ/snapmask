/**
 * Structural diff between two (already masked, already canonical)
 * JSON documents. Positional for arrays — element order is contract.
 *
 * Entries come out in document walk order: a report that reads
 * top-to-bottom like the payload does.
 */

import { canonicalize, deepEqual } from "./canon.js";
import { formatPointer } from "./pointer.js";
import type { DiffEntry, JsonObject, JsonValue } from "./types.js";

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diffAt(
  before: JsonValue,
  after: JsonValue,
  path: string[],
  out: DiffEntry[],
): void {
  if (deepEqual(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i++) {
      diffAt(before[i] as JsonValue, after[i] as JsonValue, [...path, String(i)], out);
    }
    for (let i = shared; i < before.length; i++) {
      out.push({
        path: formatPointer([...path, String(i)]),
        type: "removed",
        before: before[i] as JsonValue,
      });
    }
    for (let i = shared; i < after.length; i++) {
      out.push({
        path: formatPointer([...path, String(i)]),
        type: "added",
        after: after[i] as JsonValue,
      });
    }
    return;
  }

  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const inBefore = Object.prototype.hasOwnProperty.call(before, key);
      const inAfter = Object.prototype.hasOwnProperty.call(after, key);
      const childPath = [...path, key];
      if (inBefore && !inAfter) {
        out.push({
          path: formatPointer(childPath),
          type: "removed",
          before: before[key] as JsonValue,
        });
      } else if (!inBefore && inAfter) {
        out.push({
          path: formatPointer(childPath),
          type: "added",
          after: after[key] as JsonValue,
        });
      } else {
        diffAt(before[key] as JsonValue, after[key] as JsonValue, childPath, out);
      }
    }
    return;
  }

  // Leaf change, or a change of shape (leaf vs container) — one entry.
  out.push({ path: formatPointer(path), type: "changed", before, after });
}

/** Diff two documents; empty array means byte-equivalent snapshots. */
export function diffDocuments(before: JsonValue, after: JsonValue): DiffEntry[] {
  const out: DiffEntry[] = [];
  diffAt(canonicalize(before), canonicalize(after), [], out);
  return out;
}
