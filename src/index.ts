/**
 * Public programmatic API. Everything the CLI does is available as
 * pure functions, so snapmask can back an `expect`-style assertion in
 * any test runner:
 *
 *   const { masked } = maskDocument(response, snapshot.rules);
 *   assert.deepStrictEqual(masked, snapshot.masked);
 */

export { canonicalize, canonicalJson, deepEqual, parseJsonDocument } from "./canon.js";
export { detectNumber, detectString, detectValue, shapeSignature } from "./detect.js";
export { diffDocuments } from "./diff.js";
export { maskDocument } from "./mask.js";
export {
  escapeSegment,
  formatPointer,
  generalizePointer,
  getAtPointer,
  parsePointer,
  pointerMatches,
  unescapeSegment,
} from "./pointer.js";
export {
  maskSummary,
  renderCheckFailure,
  renderCheckSuccess,
  renderDiffEntry,
  renderExplain,
  renderLearn,
  renderValue,
} from "./report.js";
export {
  DEFAULT_DIR,
  listSnapshots,
  parseSnapshot,
  readSnapshot,
  serializeSnapshot,
  snapshotPath,
  validateName,
  writeSnapshot,
} from "./snapshot.js";
export type {
  CandidateField,
  Confidence,
  Detection,
  DetectorKind,
  DiffEntry,
  JsonObject,
  JsonValue,
  LearnResult,
  MaskResult,
  MaskRule,
  MaskedField,
  RuleSource,
  Snapshot,
} from "./types.js";
export { classifyVariance, learnRules, mergeRules } from "./variance.js";
export { VERSION } from "./version.js";
