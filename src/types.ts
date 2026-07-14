/**
 * Shared types for snapmask.
 *
 * The public data model is small on purpose: JSON values, detections,
 * mask rules, mask results, diffs, and the snapshot file format.
 */

/** Any value representable in a JSON document. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON object (the only non-leaf besides arrays). */
export type JsonObject = { [key: string]: JsonValue };

/**
 * What a value looks like. Kinds double as the mask token label,
 * e.g. a `uuid` detection masks to `<uuid:1>`.
 */
export type DetectorKind =
  // Confident kinds: masked on shape alone. These formats are volatile
  // by construction (they embed time, randomness, or signatures).
  | "uuid"
  | "ulid"
  | "objectid"
  | "jwt"
  | "timestamp-iso"
  | "timestamp-http"
  // Candidate kinds: the shape is suggestive but not conclusive
  // (an integer may or may not be an epoch). They are only masked
  // once cross-run variance confirms the field actually moves.
  | "epoch-seconds"
  | "epoch-millis"
  | "hex-digest"
  | "duration"
  // Variance-only kinds: assigned by `learnRules` to fields that
  // changed between runs but match no named format.
  | "counter"
  | "number"
  | "token"
  | "value";

/**
 * How sure a shape detector is.
 *
 * - `confident`: masked immediately, no variance evidence needed.
 * - `candidate`: recorded by `explain`, but masked only when a learned
 *   rule (from cross-run variance) or a manual rule targets the path.
 */
export type Confidence = "confident" | "candidate";

/** The result of running the shape detectors over a single value. */
export interface Detection {
  kind: DetectorKind;
  confidence: Confidence;
}

/** Where a mask rule came from. */
export type RuleSource = "shape" | "variance" | "manual";

/**
 * A learned or manual masking rule. `path` is a JSON Pointer whose
 * segments may be the wildcard `*` (matches exactly one segment,
 * typically an array index). A rule may target a leaf or a subtree.
 */
export interface MaskRule {
  path: string;
  kind: DetectorKind;
  source: RuleSource;
}

/** One field that was masked, and why. */
export interface MaskedField {
  /** Concrete JSON Pointer of the masked value. */
  path: string;
  kind: DetectorKind;
  source: RuleSource;
  /** The replacement token, e.g. `<uuid:2>`. */
  token: string;
}

/** A candidate the detectors noticed but did not mask (see `explain`). */
export interface CandidateField {
  path: string;
  kind: DetectorKind;
}

/** Output of `maskDocument`. */
export interface MaskResult {
  masked: JsonValue;
  fields: MaskedField[];
  candidates: CandidateField[];
}

/** Output of `learnRules`. */
export interface LearnResult {
  rules: MaskRule[];
  /**
   * Structural differences between runs (a key present in one run but
   * not another, arrays of different lengths). These cannot be masked
   * away by a value rule, so they are surfaced instead of hidden.
   */
  warnings: string[];
}

/** One structural difference between two masked documents. */
export interface DiffEntry {
  path: string;
  type: "changed" | "added" | "removed";
  before?: JsonValue;
  after?: JsonValue;
}

/** The on-disk snapshot file format (versioned, rejected if unknown). */
export interface Snapshot {
  snapmask: 1;
  name: string;
  rules: MaskRule[];
  masked: JsonValue;
}
