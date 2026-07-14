/**
 * Minimal, strict CLI argument parser. Unknown flags are usage errors
 * (exit 2) — a typo like `--updaet` must never silently pass a check.
 */

export class UsageError extends Error {}

export interface ParsedArgs {
  command: string | null;
  positionals: string[];
  name: string | null;
  dir: string | null;
  json: boolean;
  update: boolean;
  explain: boolean;
  help: boolean;
  version: boolean;
}

const VALUE_FLAGS = new Set(["--name", "--dir"]);
const BOOL_FLAGS = new Set(["--json", "--update", "--explain", "--help", "--version", "-h", "-V"]);

/** Parse argv (already stripped of node + script). Throws UsageError. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    positionals: [],
    name: null,
    dir: null,
    json: false,
    update: false,
    explain: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-" || !arg.startsWith("-")) {
      if (parsed.command === null && arg !== "-") parsed.command = arg;
      else parsed.positionals.push(arg);
      continue;
    }
    let flag = arg;
    let inlineValue: string | null = null;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      flag = arg.slice(0, eq);
      inlineValue = arg.slice(eq + 1);
    }
    if (VALUE_FLAGS.has(flag)) {
      let value = inlineValue;
      if (value === null) {
        value = argv[i + 1] ?? null;
        if (value === null) throw new UsageError(`${flag} requires a value`);
        i++;
      }
      if (flag === "--name") parsed.name = value;
      else parsed.dir = value;
      continue;
    }
    if (BOOL_FLAGS.has(flag)) {
      if (inlineValue !== null) throw new UsageError(`${flag} does not take a value`);
      if (flag === "--json") parsed.json = true;
      else if (flag === "--update") parsed.update = true;
      else if (flag === "--explain") parsed.explain = true;
      else if (flag === "--help" || flag === "-h") parsed.help = true;
      else parsed.version = true;
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }

  return parsed;
}
