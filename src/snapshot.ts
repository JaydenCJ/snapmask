/**
 * The snapshot store: versioned JSON files under `__snapmasks__/`
 * (or `--dir`), one per named snapshot. A file carries the masked
 * document AND the learned rules, so `check` re-applies exactly the
 * masking that was recorded — rules travel with the snapshot, not in
 * a separate config that can drift.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalJson } from "./canon.js";
import { parsePointer } from "./pointer.js";
import type { JsonValue, MaskRule, Snapshot } from "./types.js";

export const DEFAULT_DIR = "__snapmasks__";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const KINDS = new Set([
  "uuid", "ulid", "objectid", "jwt", "timestamp-iso", "timestamp-http",
  "epoch-seconds", "epoch-millis", "hex-digest", "duration",
  "counter", "number", "token", "value",
]);

const SOURCES = new Set(["shape", "variance", "manual"]);

/** Validate a snapshot name (it becomes a filename). */
export function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid snapshot name ${JSON.stringify(name)} (allowed: letters, digits, ".", "_", "-")`,
    );
  }
}

export function snapshotPath(dir: string, name: string): string {
  return path.join(dir, `${name}.snap.json`);
}

/** Serialize a snapshot deterministically (fixed top-level key order). */
export function serializeSnapshot(snap: Snapshot): string {
  const body: JsonValue = {
    snapmask: 1,
    name: snap.name,
    rules: snap.rules.map((rule) => ({
      path: rule.path,
      kind: rule.kind,
      source: rule.source,
    })),
    masked: snap.masked,
  };
  // canonicalJson sorts keys; the fixed field names happen to sort
  // stably, and rule objects keep a canonical shape either way.
  return canonicalJson(body);
}

/** Parse + validate snapshot file content. Throws with a clear reason. */
export function parseSnapshot(text: string, label: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${label}: not valid JSON`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: expected a snapshot object`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj["snapmask"] !== 1) {
    throw new Error(
      `${label}: unsupported snapshot format (expected "snapmask": 1, got ${JSON.stringify(obj["snapmask"])})`,
    );
  }
  if (typeof obj["name"] !== "string") {
    throw new Error(`${label}: missing "name"`);
  }
  if (!Array.isArray(obj["rules"])) {
    throw new Error(`${label}: missing "rules" array`);
  }
  const rules: MaskRule[] = (obj["rules"] as unknown[]).map((entry, i) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}: rules[${i}] is not an object`);
    }
    const rule = entry as Record<string, unknown>;
    if (typeof rule["path"] !== "string") {
      throw new Error(`${label}: rules[${i}] has no "path"`);
    }
    parsePointer(rule["path"]); // throws on malformed pointers
    if (typeof rule["kind"] !== "string" || !KINDS.has(rule["kind"])) {
      throw new Error(`${label}: rules[${i}] has unknown kind ${JSON.stringify(rule["kind"])}`);
    }
    if (typeof rule["source"] !== "string" || !SOURCES.has(rule["source"])) {
      throw new Error(`${label}: rules[${i}] has unknown source ${JSON.stringify(rule["source"])}`);
    }
    return {
      path: rule["path"],
      kind: rule["kind"] as MaskRule["kind"],
      source: rule["source"] as MaskRule["source"],
    };
  });
  if (!("masked" in obj)) {
    throw new Error(`${label}: missing "masked" document`);
  }
  return {
    snapmask: 1,
    name: obj["name"],
    rules,
    masked: obj["masked"] as JsonValue,
  };
}

/** Read a snapshot by name; returns null when it does not exist. */
export function readSnapshot(dir: string, name: string): Snapshot | null {
  const file = snapshotPath(dir, name);
  if (!fs.existsSync(file)) return null;
  return parseSnapshot(fs.readFileSync(file, "utf8"), file);
}

/**
 * Write a snapshot; creates the directory as needed. Returns
 * "written" or "unchanged" so callers can report idempotence.
 */
export function writeSnapshot(dir: string, snap: Snapshot): "written" | "unchanged" {
  validateName(snap.name);
  const file = snapshotPath(dir, snap.name);
  const next = serializeSnapshot(snap);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === next) {
    return "unchanged";
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, next);
  return "written";
}

/** List snapshot names in a directory, sorted. */
export function listSnapshots(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".snap.json"))
    .map((entry) => entry.slice(0, -".snap.json".length))
    .sort();
}
