// Shared test helpers: a temp-workspace factory for filesystem-facing
// tests and a runner for the built CLI. Every workspace lives under a
// mkdtemp directory and is removed when the process exits, so tests
// are deterministic and leave no state behind.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");

const created = [];
process.on("exit", () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Create a throwaway workspace populated with the given files
 * (relative path → content; objects are JSON-encoded). Returns its
 * absolute path.
 */
export function workspace(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "snapmask-test-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    writeFileSync(abs, text, "utf8");
  }
  return dir;
}

/** Run the built CLI; returns { status, stdout, stderr }. */
export function runCli(args, cwd, stdin) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Two runs of the same realistic API payload, used across suites:
 * the request id, timestamp, sequence counter and etag move between
 * runs; the item ids and business data (names, quantities, total) do
 * not. This is the exact situation snapmask exists for.
 */
export function ordersRun(n) {
  const requestIds = [
    "a3bb189e-8bf9-4c8b-9c4b-1a2b3c4d5e6f",
    "550e8400-e29b-41d4-a716-446655440000",
    "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  ];
  const etags = [
    "9e107d9d372bb6826bd81d3542a419d6",
    "e4d909c290d0fb1ca068ffaddf22cbd0",
    "d41d8cd98f00b204e9800998ecf8427e",
  ];
  return {
    requestId: requestIds[n],
    servedAt: `2026-07-13T08:1${n}:30Z`,
    seq: 101 + n,
    etag: etags[n],
    customer: { id: "0b8f8f0e-2f6a-4c8e-9d3b-7a1c2e3f4a5b", name: "Ada Lovelace" },
    items: [
      { sku: "WIDGET-9", qty: 2, ownerId: "0b8f8f0e-2f6a-4c8e-9d3b-7a1c2e3f4a5b" },
      { sku: "SPROCKET-1", qty: 1, ownerId: "0b8f8f0e-2f6a-4c8e-9d3b-7a1c2e3f4a5b" },
    ],
    total: 3,
  };
}
