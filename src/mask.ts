/**
 * Masking: replace volatile values with stable, referentially
 * consistent tokens before a snapshot is stored or diffed.
 *
 * Two things fire a mask:
 *   1. a rule (learned from cross-run variance, or manual) whose
 *      pointer matches the node — rules may target leaves or subtrees;
 *   2. a *confident* shape detection on a leaf (UUID, ULID, ObjectId,
 *      JWT, ISO / HTTP timestamp).
 *
 * Tokens are numbered per kind in first-occurrence order over the
 * canonical walk, and repeated source values reuse their token:
 * if `user.id` and `orders[2].userId` hold the same UUID, both become
 * `<uuid:1>` — so a snapshot still verifies that the reference points
 * at the *same* entity, without pinning which random id it was.
 */

import { canonicalize } from "./canon.js";
import { detectValue } from "./detect.js";
import { formatPointer, parsePointer, pointerMatches } from "./pointer.js";
import type {
  CandidateField,
  JsonObject,
  JsonValue,
  MaskResult,
  MaskRule,
  MaskedField,
} from "./types.js";

interface ParsedRule {
  segments: string[];
  rule: MaskRule;
}

class TokenTable {
  private readonly byKind = new Map<string, Map<string, number>>();

  /** Token for (kind, source value); repeat values get the same number. */
  token(kind: string, sourceValue: JsonValue): string {
    let values = this.byKind.get(kind);
    if (!values) {
      values = new Map();
      this.byKind.set(kind, values);
    }
    const key = JSON.stringify(sourceValue);
    let n = values.get(key);
    if (n === undefined) {
      n = values.size + 1;
      values.set(key, n);
    }
    return `<${kind}:${n}>`;
  }
}

function findRule(parsed: readonly ParsedRule[], path: readonly string[]): MaskRule | null {
  for (const { segments, rule } of parsed) {
    if (pointerMatches(segments, path)) return rule;
  }
  return null;
}

/**
 * Mask a document. The input is canonicalized first, so the result —
 * including token numbering — is independent of input key order.
 */
export function maskDocument(doc: JsonValue, rules: readonly MaskRule[] = []): MaskResult {
  const parsed: ParsedRule[] = rules.map((rule) => ({
    segments: parsePointer(rule.path),
    rule,
  }));
  const tokens = new TokenTable();
  const fields: MaskedField[] = [];
  const candidates: CandidateField[] = [];

  function visit(value: JsonValue, path: string[]): JsonValue {
    const rule = findRule(parsed, path);
    if (rule) {
      const token = tokens.token(rule.kind, value);
      fields.push({ path: formatPointer(path), kind: rule.kind, source: rule.source, token });
      return token;
    }
    if (Array.isArray(value)) {
      return value.map((item, i) => visit(item as JsonValue, [...path, String(i)]));
    }
    if (value !== null && typeof value === "object") {
      const out: JsonObject = {};
      for (const key of Object.keys(value)) {
        out[key] = visit((value as JsonObject)[key] as JsonValue, [...path, key]);
      }
      return out;
    }
    const detection = detectValue(value);
    if (detection) {
      if (detection.confidence === "confident") {
        const token = tokens.token(detection.kind, value);
        fields.push({ path: formatPointer(path), kind: detection.kind, source: "shape", token });
        return token;
      }
      candidates.push({ path: formatPointer(path), kind: detection.kind });
    }
    return value;
  }

  const masked = visit(canonicalize(doc), []);
  return { masked, fields, candidates };
}
