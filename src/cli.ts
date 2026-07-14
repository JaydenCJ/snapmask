#!/usr/bin/env node
/**
 * The snapmask CLI. All I/O lives here — the modules underneath take
 * data and return data. Exit codes: 0 clean, 1 snapshot mismatch,
 * 2 usage or input error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs, UsageError, type ParsedArgs } from "./args.js";
import { canonicalJson, parseJsonDocument } from "./canon.js";
import { diffDocuments } from "./diff.js";
import { maskDocument } from "./mask.js";
import {
  maskSummary,
  plural,
  renderCheckFailure,
  renderCheckSuccess,
  renderExplain,
  renderLearn,
  renderLsEntry,
} from "./report.js";
import {
  DEFAULT_DIR,
  listSnapshots,
  readSnapshot,
  snapshotPath,
  validateName,
  writeSnapshot,
} from "./snapshot.js";
import type { JsonValue, MaskRule, Snapshot } from "./types.js";
import { learnRules, mergeRules } from "./variance.js";
import { VERSION } from "./version.js";

const USAGE = `snapmask ${VERSION} — JSON snapshot testing with automatic volatility masking

Usage:
  snapmask snap <run.json> [more-runs.json…] [--name N] [--dir D]
  snapmask check <run.json> [--name N] [--dir D] [--update] [--json]
  snapmask mask <run.json> [--name N] [--dir D] [--explain]
  snapmask learn <run-a.json> <run-b.json> [more…] [--json]
  snapmask ls [--dir D]

Commands:
  snap    Record (or re-record) a snapshot. Extra run files feed
          cross-run variance learning; learned rules are stored in the
          snapshot and merged with rules learned earlier.
  check   Mask a fresh run with the snapshot's rules and diff it
          against the stored masked document. --update accepts drift.
  mask    Print the masked document (stdout, canonical JSON). With
          --name, apply that snapshot's learned rules too. --explain
          lists every masked field, its kind, and unmasked candidates.
  learn   Infer mask rules from two or more runs and print them.
  ls      List snapshots in the store.

Options:
  --name N       Snapshot name (default: first input's basename)
  --dir D        Snapshot directory (default: ${DEFAULT_DIR})
  --update       On check mismatch, rewrite the snapshot and exit 0
  --explain      With mask: report fields instead of the document
  --json         Machine-readable output (check, learn)
  --version, -V  Print the version
  --help, -h     Print this help

Inputs are files or "-" for stdin.

Exit codes:
  0  clean / snapshot matches
  1  snapshot mismatch
  2  usage or input error
`;

class InputError extends Error {}

function readInput(input: string): string {
  if (input === "-") {
    return fs.readFileSync(0, "utf8");
  }
  if (!fs.existsSync(input)) {
    throw new InputError(`no such file: ${input}`);
  }
  if (fs.statSync(input).isDirectory()) {
    throw new InputError(`expected a JSON file, got a directory: ${input}`);
  }
  return fs.readFileSync(input, "utf8");
}

function readDocument(input: string): JsonValue {
  return parseJsonDocument(readInput(input), input === "-" ? "stdin" : input);
}

function defaultName(input: string): string {
  if (input === "-") {
    throw new UsageError("--name is required when reading from stdin");
  }
  const base = path.basename(input);
  return base.endsWith(".json") ? base.slice(0, -".json".length) : base;
}

function resolveName(args: ParsedArgs): string {
  const name = args.name ?? defaultName(args.positionals[0] as string);
  validateName(name);
  return name;
}

function requireInputs(args: ParsedArgs, min: number, command: string): void {
  if (args.positionals.length < min) {
    throw new UsageError(
      `${command} needs at least ${min} input file${min === 1 ? "" : "s"} (got ${args.positionals.length})`,
    );
  }
}

// --- Commands -----------------------------------------------------------

function cmdSnap(args: ParsedArgs): number {
  requireInputs(args, 1, "snap");
  const dir = args.dir ?? DEFAULT_DIR;
  const name = resolveName(args);
  const runs = args.positionals.map((input) => readDocument(input));

  let learned: MaskRule[] = [];
  if (runs.length >= 2) {
    const result = learnRules(runs);
    learned = result.rules;
    for (const warning of result.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
  }
  const existing = readSnapshot(dir, name);
  const rules = mergeRules(existing?.rules ?? [], learned);

  const { masked, fields } = maskDocument(runs[0] as JsonValue, rules);
  const snap: Snapshot = { snapmask: 1, name, rules, masked };
  const status = writeSnapshot(dir, snap);
  const learnedNote =
    runs.length >= 2 ? `, ${plural(learned.length, "rule")} learned from ${runs.length} runs` : "";
  process.stdout.write(
    `✓ ${name} → ${snapshotPath(dir, name)} (${status})\n  ${maskSummary(fields)}${learnedNote}\n`,
  );
  return 0;
}

function cmdCheck(args: ParsedArgs): number {
  requireInputs(args, 1, "check");
  if (args.positionals.length > 1) {
    throw new UsageError("check takes exactly one run (learn variance with `snapmask snap a.json b.json`)");
  }
  const dir = args.dir ?? DEFAULT_DIR;
  const name = resolveName(args);
  const snap = readSnapshot(dir, name);
  if (!snap) {
    throw new InputError(
      `no snapshot named ${JSON.stringify(name)} in ${dir} — record one with: snapmask snap <run.json> --name ${name}`,
    );
  }
  const doc = readDocument(args.positionals[0] as string);
  const { masked, fields } = maskDocument(doc, snap.rules);
  const diff = diffDocuments(snap.masked, masked);
  const ok = diff.length === 0;

  if (!ok && args.update) {
    writeSnapshot(dir, { ...snap, masked });
    if (args.json) {
      const payload = {
        tool: "snapmask",
        version: VERSION,
        name,
        ok: true,
        updated: true,
        maskedFields: fields.length,
        rules: snap.rules,
        differences: diff, // the differences that were accepted
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      process.stdout.write(
        `✓ ${name} — snapshot updated (${plural(diff.length, "accepted difference")})\n`,
      );
    }
    return 0;
  }
  if (args.json) {
    const payload = {
      tool: "snapmask",
      version: VERSION,
      name,
      ok,
      updated: false,
      maskedFields: fields.length,
      rules: snap.rules,
      differences: diff,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return ok ? 0 : 1;
  }
  process.stdout.write((ok ? renderCheckSuccess(name, fields) : renderCheckFailure(name, diff)) + "\n");
  return ok ? 0 : 1;
}

function cmdMask(args: ParsedArgs): number {
  requireInputs(args, 1, "mask");
  const doc = readDocument(args.positionals[0] as string);
  let rules: MaskRule[] = [];
  if (args.name !== null) {
    const dir = args.dir ?? DEFAULT_DIR;
    validateName(args.name);
    const snap = readSnapshot(dir, args.name);
    if (!snap) {
      throw new InputError(`no snapshot named ${JSON.stringify(args.name)} in ${dir}`);
    }
    rules = snap.rules;
  }
  const { masked, fields, candidates } = maskDocument(doc, rules);
  if (args.explain) {
    process.stdout.write(renderExplain(fields, candidates) + "\n");
  } else {
    process.stdout.write(canonicalJson(masked));
  }
  return 0;
}

function cmdLearn(args: ParsedArgs): number {
  requireInputs(args, 2, "learn");
  const runs = args.positionals.map((input) => readDocument(input));
  const result = learnRules(runs);
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(renderLearn(result, runs.length) + "\n");
  }
  return 0;
}

function cmdLs(args: ParsedArgs): number {
  const dir = args.dir ?? DEFAULT_DIR;
  const names = listSnapshots(dir);
  if (names.length === 0) {
    process.stdout.write(`no snapshots in ${dir}\n`);
    return 0;
  }
  for (const name of names) {
    const snap = readSnapshot(dir, name);
    process.stdout.write(renderLsEntry(name, snap?.rules ?? []) + "\n");
  }
  return 0;
}

// --- Entry point --------------------------------------------------------

export function main(argv: readonly string[]): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`snapmask: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args.help || args.command === null) {
    process.stdout.write(USAGE);
    return args.help ? 0 : 2;
  }
  try {
    switch (args.command) {
      case "snap":
        return cmdSnap(args);
      case "check":
        return cmdCheck(args);
      case "mask":
        return cmdMask(args);
      case "learn":
        return cmdLearn(args);
      case "ls":
        return cmdLs(args);
      default:
        throw new UsageError(`unknown command: ${args.command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`snapmask: ${error.message}\n\n${USAGE}`);
    } else {
      process.stderr.write(`snapmask: ${(error as Error).message}\n`);
    }
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
