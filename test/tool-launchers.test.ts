import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
    const content = buildPnpmLauncherContent(nodeExecutable, pnpmEntry, "win32");

    // Then: the console is switched to UTF-8 first (pnpm diagnostics would
    // otherwise arrive as GBK garbage on Chinese Windows), and the vendored
    // node runs the vendored pnpm entry with every argument forwarded
    expect(content).toBe(
      '@chcp 65001 >nul\n@"C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe" "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\n',
    );
  });

  it("builds a POSIX sh launcher that runs pnpm.cjs with the vendored node on darwin", () => {
    // Given: vendored executables under a spaced macOS userData path
    const nodeExecutable =
      "/Users/tester/Library/Application Support/DSH Flightdeck/app/node_modules/node/bin/node";
    const pnpmEntry =
      "/Users/tester/Library/Application Support/DSH Flightdeck/app/node_modules/pnpm/bin/pnpm.cjs";

    // When: the darwin launcher content is built
    const content = buildPnpmLauncherContent(nodeExecutable, pnpmEntry, "darwin");

    // Then: an sh shebang execs the vendored node over the vendored pnpm
    // entry, with quoted paths and every argument forwarded
    expect(content).toBe(
      '#!/bin/sh\nexec "/Users/tester/Library/Application Support/DSH Flightdeck/app/node_modules/node/bin/node" "/Users/tester/Library/Application Support/DSH Flightdeck/app/node_modules/pnpm/bin/pnpm.cjs" "$@"\n',
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

  it("writes an executable pnpm sh shim on darwin", async () => {
    // Given: a fresh per-test tools directory and darwin vendored paths
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-pnpm-shim-darwin-"));
    const toolsDir = join(root, "tools");
    const nodeExecutable = "/app/node_modules/node/bin/node";
    const pnpmEntry = "/app/node_modules/pnpm/bin/pnpm.cjs";
    try {
      // When: the launcher is materialized for darwin
      const launcher = await writePnpmLauncher({ toolsDir, nodeExecutable, pnpmEntry, platform: "darwin" });

      // Then: it lands at toolsDir/pnpm (no extension) as an executable
      // shell script execing the vendored node
      expect(launcher).toBe(join(toolsDir, "pnpm"));
      expect(await readFile(launcher ?? "", "utf8")).toBe(
        `#!/bin/sh\nexec "${nodeExecutable}" "${pnpmEntry}" "$@"\n`,
      );
      expect((await stat(launcher ?? "")).mode & 0o111).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op on unsupported platforms without touching the filesystem", async () => {
    // Given: a fresh per-test root and a linux platform
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-pnpm-shim-linux-"));
    const toolsDir = join(root, "tools");
    try {
      // When: the launcher is materialized for linux
      const result = await writePnpmLauncher({
        toolsDir,
        nodeExecutable: "/unused/node",
        pnpmEntry: "/unused/pnpm.cjs",
        platform: "linux",
      });

      // Then: nothing is written (only win32 and darwin get launchers)
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
    const content = buildDshLauncherContent(nodeExecutable, dshBin, "win32");

    // Then: the console is switched to UTF-8 first and every argument is forwarded
    expect(content).toBe(
      '@chcp 65001 >nul\n@"C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\node\\bin\\node.exe" "C:\\Program Files\\DSH Flightdeck\\resources\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*\n',
    );
  });

  it("builds a POSIX sh launcher that runs the DSH CLI entry on darwin", () => {
    // Given: the vendored node and the runtime-paths DSH entry on macOS
    const nodeExecutable = "/app/node_modules/node/bin/node";
    const dshBin = "/app/node_modules/@deepseek-ai/dsh/lib/bin.js";

    // When: the darwin launcher content is built
    const content = buildDshLauncherContent(nodeExecutable, dshBin, "darwin");

    // Then: an sh shebang execs the vendored node over the DSH entry
    expect(content).toBe(`#!/bin/sh\nexec "${nodeExecutable}" "${dshBin}" "$@"\n`);
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

  it("writes an executable dsh sh shim on darwin", async () => {
    // Given: a fresh per-test tools directory and darwin vendored paths
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-dsh-shim-darwin-"));
    const toolsDir = join(root, "tools");
    const dshBin = "/app/node_modules/@deepseek-ai/dsh/lib/bin.js";
    try {
      // When: the launcher is materialized for darwin
      const launcher = await writeDshLauncher({
        toolsDir,
        nodeExecutable: "/app/node_modules/node/bin/node",
        dshBin,
        platform: "darwin",
      });

      // Then: it lands at toolsDir/dsh as an executable shell script whose
      // argv[1] path ends in /dsh (the dshArgv regex probe shape)
      expect(launcher).toBe(join(toolsDir, "dsh"));
      expect(await readFile(launcher ?? "", "utf8")).toBe(
        `#!/bin/sh\nexec "/app/node_modules/node/bin/node" "${dshBin}" "$@"\n`,
      );
      expect((await stat(launcher ?? "")).mode & 0o111).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op on unsupported platforms without touching the filesystem", async () => {
    // Given: a fresh per-test root and a linux platform
    const root = await mkdtemp(join(tmpdir(), "dsh-flightdeck-dsh-shim-linux-"));
    const toolsDir = join(root, "tools");
    try {
      // When: the launcher is materialized for linux
      const result = await writeDshLauncher({
        toolsDir,
        nodeExecutable: "/unused/node",
        dshBin: "/unused/bin.js",
        platform: "linux",
      });

      // Then: nothing is written (only win32 and darwin get launchers)
      expect(result).toBeNull();
      await expect(access(toolsDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
