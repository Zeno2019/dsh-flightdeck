import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDshLauncherContent,
  buildPnpmLauncherContent,
  resolvePnpmEntry,
  writeDshLauncher,
  writePnpmLauncher,
} from "../src/main/tool-launchers.js";

describe("resolvePnpmEntry", () => {
  it("resolves the vendored pnpm entry inside the packaged app on win32", () => {
    // Given: the packaged app root on Windows
    const appRoot = "C:\\Program Files\\DSH Flightdeck\\resources\\app";

    // When: the pnpm package entry is resolved for win32
    const entry = resolvePnpmEntry(appRoot, "win32");

    // Then: it is the pnpm.cjs shipped by the pinned pnpm package
    expect(entry).toBe("C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\pnpm\\bin\\pnpm.cjs");
  });

  it("resolves the vendored pnpm entry with POSIX semantics in dev", () => {
    // Given: the repository root on a POSIX platform
    const appRoot = "/Users/tester/dsh-flightdeck";

    // When: the pnpm package entry is resolved for darwin
    const entry = resolvePnpmEntry(appRoot, "darwin");

    // Then: it keeps POSIX separators
    expect(entry).toBe("/Users/tester/dsh-flightdeck/node_modules/pnpm/bin/pnpm.cjs");
  });
});

describe("buildPnpmLauncherContent", () => {
  it("builds a UTF-8 cmd launcher that runs pnpm.cjs with the vendored node", () => {
    // Given: vendored executables under a spaced install path
    const nodeExecutable = "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe";
    const pnpmEntry = "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\pnpm\\bin\\pnpm.cjs";

    // When: the win32 launcher content is built
    const content = buildPnpmLauncherContent(nodeExecutable, pnpmEntry);

    // Then: the console is switched to UTF-8 first (pnpm diagnostics would
    // otherwise arrive as GBK garbage on Chinese Windows), and the vendored
    // node runs the vendored pnpm entry with every argument forwarded
    expect(content).toBe(
      '@chcp 65001 >nul\n@"C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe" "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\n',
    );
  });
});

describe("writePnpmLauncher", () => {
  it("writes pnpm.cmd on win32 and rewrites it on every startup", async () => {
    // Given: a fresh per-test tools directory and win32 vendored paths
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-pnpm-shim-"));
    const toolsDir = join(root, "tools");
    const firstNode = "C:\\first\\node.exe";
    const pnpmEntry = "C:\\pnpm.cjs";
    try {
      // When: the launcher is materialized for win32
      const first = await writePnpmLauncher({ toolsDir, nodeExecutable: firstNode, pnpmEntry, platform: "win32" });

      // Then: it lands at toolsDir/pnpm.cmd and forwards to the vendored node
      expect(first).toBe(join(toolsDir, "pnpm.cmd"));
      expect(await readFile(first ?? "", "utf8")).toContain('@"C:\\first\\node.exe"');

      // When: a later startup (upgraded install) writes an updated node path
      const upgradedNode = "C:\\second\\node.exe";
      await writePnpmLauncher({ toolsDir, nodeExecutable: upgradedNode, pnpmEntry, platform: "win32" });

      // Then: the same file is rewritten, never leaving a stale path behind
      const rewritten = await readFile(join(toolsDir, "pnpm.cmd"), "utf8");
      expect(rewritten).toContain('@"C:\\second\\node.exe"');
      expect(rewritten).not.toContain("C:\\first");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op on non-win32 platforms without touching the filesystem", async () => {
    // Given: a fresh per-test root and a darwin platform
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-pnpm-shim-posix-"));
    const toolsDir = join(root, "tools");
    try {
      // When: the launcher is materialized for darwin
      const result = await writePnpmLauncher({
        toolsDir,
        nodeExecutable: "/unused/node",
        pnpmEntry: "/unused/pnpm.cjs",
        platform: "darwin",
      });

      // Then: nothing is written (product packages Windows only)
      expect(result).toBeNull();
      await expect(access(toolsDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("buildDshLauncherContent", () => {
  it("builds a UTF-8 cmd launcher that runs the DSH CLI entry with the vendored node", () => {
    // Given: the vendored node and the runtime-paths DSH entry on Windows
    const nodeExecutable = "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe";
    const dshBin = "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";

    // When: the win32 launcher content is built
    const content = buildDshLauncherContent(nodeExecutable, dshBin);

    // Then: the console is switched to UTF-8 first and every argument is forwarded
    expect(content).toBe(
      '@chcp 65001 >nul\n@"C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe" "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*\n',
    );
  });
});

describe("writeDshLauncher", () => {
  it("writes dsh.cmd on win32 and rewrites it on every startup", async () => {
    // Given: a fresh per-test tools directory and win32 vendored paths
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-dsh-shim-"));
    const toolsDir = join(root, "tools");
    const dshBin = "C:\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
    try {
      // When: the launcher is materialized for win32
      const first = await writeDshLauncher({
        toolsDir,
        nodeExecutable: "C:\\first\\node.exe",
        dshBin,
        platform: "win32",
      });

      // Then: it lands at toolsDir/dsh.cmd and runs the DSH entry with the vendored node
      expect(first).toBe(join(toolsDir, "dsh.cmd"));
      expect(await readFile(first ?? "", "utf8")).toContain(dshBin);
      expect(await readFile(first ?? "", "utf8")).toContain('@"C:\\first\\node.exe"');

      // When: a later startup (upgraded install) writes an updated node path
      await writeDshLauncher({
        toolsDir,
        nodeExecutable: "C:\\second\\node.exe",
        dshBin,
        platform: "win32",
      });

      // Then: the same file is rewritten, never leaving a stale path behind
      const rewritten = await readFile(join(toolsDir, "dsh.cmd"), "utf8");
      expect(rewritten).toContain('@"C:\\second\\node.exe"');
      expect(rewritten).not.toContain("C:\\first");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op on non-win32 platforms without touching the filesystem", async () => {
    // Given: a fresh per-test root and a darwin platform
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-dsh-shim-posix-"));
    const toolsDir = join(root, "tools");
    try {
      // When: the launcher is materialized for darwin
      const result = await writeDshLauncher({
        toolsDir,
        nodeExecutable: "/unused/node",
        dshBin: "/unused/bin.js",
        platform: "darwin",
      });

      // Then: nothing is written (product packages Windows only)
      expect(result).toBeNull();
      await expect(access(toolsDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
