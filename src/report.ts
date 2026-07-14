/**
 * Human-readable output for the CLI. All functions are pure
 * (strings in, strings out) so every report is unit-testable.
 */

import type {
  CandidateField,
  DiffEntry,
  JsonValue,
  LearnResult,
  MaskedField,
  MaskRule,
} from "./types.js";

const MAX_VALUE_WIDTH = 64;

/** Compact, truncated rendering of a JSON value for one-line reports. */
export function renderValue(value: JsonValue | undefined): string {
  if (value === undefined) return "(absent)";
  const text = JSON.stringify(value);
  if (text.length <= MAX_VALUE_WIDTH) return text;
  return `${text.slice(0, MAX_VALUE_WIDTH - 1)}…`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Render one diff entry as a single indented line. */
export function renderDiffEntry(entry: DiffEntry): string {
  const path = entry.path === "" ? "/" : entry.path;
  switch (entry.type) {
    case "changed":
      return `  ~ ${path}: ${renderValue(entry.before)} → ${renderValue(entry.after)}`;
    case "added":
      return `  + ${path}: added ${renderValue(entry.after)}`;
    case "removed":
      return `  - ${path}: removed ${renderValue(entry.before)}`;
  }
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Break masked-field counts down by rule source. */
export function maskSummary(fields: readonly MaskedField[]): string {
  const bySource = new Map<string, number>();
  for (const field of fields) {
    bySource.set(field.source, (bySource.get(field.source) ?? 0) + 1);
  }
  const parts = ["shape", "variance", "manual"]
    .filter((source) => bySource.has(source))
    .map((source) => `${bySource.get(source)} ${source}`);
  const detail = parts.length > 0 ? ` (${parts.join(" · ")})` : "";
  return `${plural(fields.length, "field")} masked${detail}`;
}

/** Report for `check` when the masked documents differ. */
export function renderCheckFailure(name: string, diff: readonly DiffEntry[]): string {
  const lines = [`✗ ${name} — ${plural(diff.length, "difference")} after masking`];
  for (const entry of diff) lines.push(renderDiffEntry(entry));
  lines.push(`accept with: snapmask check --update (or re-record with snapmask snap)`);
  return lines.join("\n");
}

/** Report for `check` on a clean pass. */
export function renderCheckSuccess(name: string, fields: readonly MaskedField[]): string {
  return `✓ ${name} — matches snapshot, ${maskSummary(fields)}`;
}

/** Report for `mask --explain`: what got masked, what was left alone. */
export function renderExplain(
  fields: readonly MaskedField[],
  candidates: readonly CandidateField[],
): string {
  const lines: string[] = [];
  if (fields.length === 0) {
    lines.push("masked 0 fields — nothing in this document looks volatile");
  } else {
    lines.push(`masked ${plural(fields.length, "field")}:`);
    const pathWidth = Math.max(...fields.map((f) => f.path.length));
    const kindWidth = Math.max(...fields.map((f) => f.kind.length));
    for (const field of fields) {
      lines.push(
        `  ${pad(field.path, pathWidth)}  ${pad(field.kind, kindWidth)}  ${pad(field.source, 8)}  ${field.token}`,
      );
    }
  }
  if (candidates.length > 0) {
    lines.push("candidates (shape is suggestive — confirm with `snapmask learn` before they mask):");
    const pathWidth = Math.max(...candidates.map((c) => c.path.length));
    for (const candidate of candidates) {
      lines.push(`  ${pad(candidate.path, pathWidth)}  ${candidate.kind}`);
    }
  }
  return lines.join("\n");
}

/** Report for `learn`. */
export function renderLearn(result: LearnResult, runs: number): string {
  const lines: string[] = [];
  lines.push(`learned ${plural(result.rules.length, "rule")} from ${runs} runs:`);
  if (result.rules.length === 0) {
    lines.push("  (none — the runs are already equivalent after shape masking)");
  } else {
    const pathWidth = Math.max(...result.rules.map((r) => r.path.length));
    for (const rule of result.rules) {
      lines.push(`  ${pad(rule.path, pathWidth)}  ${rule.kind}`);
    }
  }
  for (const warning of result.warnings) {
    lines.push(`warning: ${warning} — masking cannot make these runs equal`);
  }
  return lines.join("\n");
}

/** One line of `ls` output. */
export function renderLsEntry(name: string, rules: readonly MaskRule[]): string {
  const learned = rules.filter((r) => r.source === "variance").length;
  const detail =
    rules.length === 0
      ? "shape masking only"
      : `${plural(rules.length, "rule")} (${learned} learned)`;
  return `${name} — ${detail}`;
}
