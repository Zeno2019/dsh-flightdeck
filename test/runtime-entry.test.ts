import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUNTIME_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "runtime-node-entry.mjs");

interface EntryRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runRuntimeEntry(binPath: string): Promise<EntryRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--expose-internals", RUNTIME_ENTRY, binPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withTempBin(contents: string, run: (binPath: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-entry-"));
  // .mjs keeps the fixture ESM so module-evaluation failures surface through
  // the entry's top-level await import exactly as the packaged DSH bin does.
  const binPath = join(root, "dsh-bin.mjs");
  try {
    await writeFile(binPath, contents);
    await run(binPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("runtime-node-entry.mjs", () => {
  it("records the unhandledRejection reason synchronously before exiting 1", async () => {
    await withTempBin('Promise.reject(new Error("fixture boom rejection"));\n', async (binPath) => {
      // Given: a DSH bin that rejects asynchronously after module evaluation
      // When: the desktop runtime entry imports it
      const result = await runRuntimeEntry(binPath);

      // Then: the fatal marker carries the actual reason and the process exits 1
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("[desktop-runtime] unhandledRejection");
      expect(result.stderr).toContain("fixture boom rejection");
      expect(result.stdout).toContain("[desktop-runtime] Node=");
    });
  });

  it("records the uncaughtException stack synchronously before exiting 1", async () => {
    await withTempBin('setTimeout(() => { throw new Error("fixture boom exception"); }, 25);\n', async (binPath) => {
      // Given: a DSH bin that throws asynchronously after import
      // When: the desktop runtime entry imports it and the timer fires
      const result = await runRuntimeEntry(binPath);

      // Then: the fatal marker carries the stack and the process exits 1
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("[desktop-runtime] uncaughtException");
      expect(result.stderr).toContain("fixture boom exception");
    });
  });
});
