/**
 * Cross-run variance learning.
 *
 * Given two or more captures of the same payload that *should* be
 * equivalent (same request, different runs), find every path whose
 * value moved between runs and turn it into a mask rule. This is what
 * replaces the hand-maintained property-matcher list: a counter,
 * a per-request digest, or a rotating cursor does not need to be
 * declared — it needs to be observed once.
 *
 * Structural differences (a key present in only some runs, arrays of
 * different lengths, a leaf in one run vs an object in another) are
 * deliberately NOT converted into rules. Masking cannot make two
 * different shapes equal, and hiding that would defeat the snapshot.
 * They are returned as warnings instead.
 */

import { canonicalize, deepEqual } from "./canon.js";
import { detectValue, shapeSignature } from "./detect.js";
import { formatPointer, generalizePointer } from "./pointer.js";
import type {
  DetectorKind,
  JsonObject,
  JsonValue,
  LearnResult,
  MaskRule,
} from "./types.js";

type NodeType = "object" | "array" | "leaf";

function nodeType(value: JsonValue): NodeType {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "leaf";
}

/** Classify the kind for a set of differing leaf values (one per run). */
export function classifyVariance(values: readonly JsonValue[]): DetectorKind {
  if (values.every((v) => typeof v === "number")) {
    const detections = values.map((v) => detectValue(v));
    const first = detections[0];
    if (first && detections.every((d) => d !== null && d.kind === first.kind)) {
      return first.kind; // epoch-seconds / epoch-millis, confirmed by variance
    }
    return values.every((v) => Number.isInteger(v as number)) ? "counter" : "number";
  }
  if (values.every((v) => typeof v === "string")) {
    const detections = values.map((v) => detectValue(v));
    const first = detections[0];
    if (first && detections.every((d) => d !== null && d.kind === first.kind)) {
      return first.kind; // hex-digest / duration — candidate confirmed
    }
    const sig = shapeSignature(values[0] as string);
    if (values.every((v) => shapeSignature(v as string) === sig)) {
      return "token"; // fresh random value of the same shape each run
    }
    return "value";
  }
  return "value";
}

interface LearnState {
  rules: Map<string, DetectorKind[]>;
  warnings: string[];
}

function addRule(state: LearnState, path: string[], arrayFlags: boolean[], kind: DetectorKind): void {
  const generalized = formatPointer(generalizePointer(path, arrayFlags));
  const kinds = state.rules.get(generalized);
  if (kinds) kinds.push(kind);
  else state.rules.set(generalized, [kind]);
}

function learnAt(
  state: LearnState,
  values: JsonValue[],
  path: string[],
  arrayFlags: boolean[],
): void {
  const first = values[0] as JsonValue;
  if (values.every((v) => deepEqual(v, first))) return;

  const types = values.map(nodeType);
  const pointer = formatPointer(path);

  if (types.every((t) => t === "object")) {
    const allKeys = new Set<string>();
    for (const v of values) for (const key of Object.keys(v as JsonObject)) allKeys.add(key);
    for (const key of [...allKeys].sort()) {
      const present = values.filter((v) =>
        Object.prototype.hasOwnProperty.call(v as JsonObject, key),
      ).length;
      if (present !== values.length) {
        state.warnings.push(
          `structural: key ${formatPointer([...path, key])} present in ${present} of ${values.length} runs`,
        );
        continue;
      }
      learnAt(
        state,
        values.map((v) => (v as JsonObject)[key] as JsonValue),
        [...path, key],
        [...arrayFlags, false],
      );
    }
    return;
  }

  if (types.every((t) => t === "array")) {
    const lengths = values.map((v) => (v as JsonValue[]).length);
    const min = Math.min(...lengths);
    if (new Set(lengths).size > 1) {
      state.warnings.push(
        `structural: array ${pointer || "/"} has lengths ${lengths.join(", ")} across runs`,
      );
    }
    for (let i = 0; i < min; i++) {
      learnAt(
        state,
        values.map((v) => (v as JsonValue[])[i] as JsonValue),
        [...path, String(i)],
        [...arrayFlags, true],
      );
    }
    return;
  }

  if (types.some((t) => t !== "leaf")) {
    state.warnings.push(
      `structural: ${pointer || "/"} is ${[...new Set(types)].sort().join(" vs ")} across runs`,
    );
    return;
  }

  // Differing leaves. If every run already carries a confidently
  // detected value of the same kind, shape masking covers it — no rule.
  const detections = values.map((v) => detectValue(v));
  const firstDetection = detections[0];
  if (
    firstDetection &&
    firstDetection.confidence === "confident" &&
    detections.every(
      (d) => d !== null && d.confidence === "confident" && d.kind === firstDetection.kind,
    )
  ) {
    return;
  }

  addRule(state, path, arrayFlags, classifyVariance(values));
}

/** Learn mask rules from two or more runs of the same payload. */
export function learnRules(runs: readonly JsonValue[]): LearnResult {
  if (runs.length < 2) {
    throw new Error(`learnRules needs at least 2 runs, got ${runs.length}`);
  }
  const state: LearnState = { rules: new Map(), warnings: [] };
  learnAt(state, runs.map((run) => canonicalize(run)), [], []);

  const rules: MaskRule[] = [...state.rules.entries()]
    .map(([path, kinds]) => ({
      path,
      // Concrete siblings that generalized onto the same rule must
      // agree on kind; otherwise fall back to the honest "value".
      kind: kinds.every((k) => k === kinds[0]) ? (kinds[0] as DetectorKind) : "value",
      source: "variance" as const,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { rules, warnings: [...new Set(state.warnings)].sort() };
}

/** Merge learned rules into an existing set; existing paths win. */
export function mergeRules(
  existing: readonly MaskRule[],
  learned: readonly MaskRule[],
): MaskRule[] {
  const byPath = new Map<string, MaskRule>();
  for (const rule of learned) byPath.set(rule.path, rule);
  for (const rule of existing) byPath.set(rule.path, rule);
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
