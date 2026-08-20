import { chmod, mkdir, writeFile } from "node:fs/promises";
import path, { join } from "node:path";

/**
 * Runtime tool launchers for the DSH child process.
 *
 * Two market flows probe the child PATH for commands the host machine does
 * not have. dshmarket@1.14.1's one-click pnpm setup runs `pnpm --version` as
 * its success gate (`provisionPnpm`, whose `spawnEnv` keeps the inherited
 * PATH), and its plugin install re-invokes the DSH CLI — but
 * `dshArgv()` only recognizes `process.argv[1]` entries matching
 * `/[\\/](?:bin\.(?:js|ts)|dsh)$/` (dsh-cli.js:126-141); the harness entry
 * `runtime-node-entry.mjs` does not match, so the re-invocation falls back
 * to a bare `dsh` on PATH. Writing `pnpm.cmd` and `dsh.cmd` under
 * `<userData>/tools` — a directory the harness prepends to the child PATH —
 * satisfies both probes on machines without any Node tooling.
 *
 * Each launcher targets the node binary resolved by `runtime-paths`
 * (`node_modules/node/bin/node.exe` on Windows, `bin/node` on macOS),
 * never `process.execPath` — inside Electron that is the Electron binary
 * itself. Launchers are rewritten on every startup, so an upgraded app
 * never leaves a stale absolute path behind. Win32 and darwin both get
 * launchers (the two packaged platforms); every other platform is a no-op.
 */

const PNPM_CMD_NAME = "pnpm.cmd" as const;
const DSH_CMD_NAME = "dsh.cmd" as const;
const PNPM_POSIX_NAME = "pnpm" as const;
const DSH_POSIX_NAME = "dsh" as const;

/**
 * A cmd.exe launcher: UTF-8 console first (`@chcp 65001` — tool diagnostics
 * would otherwise arrive as GBK garbage on Chinese Windows, the same garbled
 * "not an internal or external command" text seen in the 0.1.0-rc.2 market
 * log), then the vendored node running the vendored entry.
 */
function buildCmdLauncherContent(nodeExecutable: string, entry: string): string {
  return `@chcp 65001 >nul\n@"${nodeExecutable}" "${entry}" %*\n`;
}

/**
 * A POSIX shell launcher: the vendored node running the vendored entry with
 * every argument forwarded. Paths are double-quoted so spaced locations
 * ("~/Library/Application Support/DSH Flightdeck/...") survive `sh`.
 */
function buildPosixLauncherContent(nodeExecutable: string, entry: string): string {
  return `#!/bin/sh\nexec "${nodeExecutable}" "${entry}" "$@"\n`;
}

/**
 * The pnpm package entry shipped inside the app closure. pnpm@11.8.0 is a
 * dependency-free JS package (engines node >=22.13, satisfied by the
 * vendored node@24.19.0), so electron-builder's production collector ships
 * it like any other direct dependency.
 */
export function resolvePnpmEntry(appRoot: string, platform: NodeJS.Platform): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(appRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
}

export function buildPnpmLauncherContent(
  nodeExecutable: string,
  pnpmEntry: string,
  platform: NodeJS.Platform,
): string {
  return platform === "win32"
    ? buildCmdLauncherContent(nodeExecutable, pnpmEntry)
    : buildPosixLauncherContent(nodeExecutable, pnpmEntry);
}

/** Launcher for the DSH CLI entry resolved by runtime-paths (`dshBin`). */
export function buildDshLauncherContent(
  nodeExecutable: string,
  dshBin: string,
  platform: NodeJS.Platform,
): string {
  return platform === "win32"
    ? buildCmdLauncherContent(nodeExecutable, dshBin)
    : buildPosixLauncherContent(nodeExecutable, dshBin);
}

interface CmdLauncherInput {
  readonly toolsDir: string;
  readonly launcherName: string;
  readonly nodeExecutable: string;
  readonly entry: string;
  readonly platform: NodeJS.Platform;
}

/**
 * Materializes `<toolsDir>/<launcherName>` for win32 (cmd) and darwin
 * (executable sh) and returns its path; a no-op (null) on every other
 * platform. Failures propagate to the caller, which degrades to an
 * uninjected PATH instead of blocking startup.
 */
async function writeCmdLauncher(input: CmdLauncherInput): Promise<string | null> {
  if (input.platform !== "win32" && input.platform !== "darwin") return null;
  await mkdir(input.toolsDir, { recursive: true });
  const launcherPath = join(input.toolsDir, input.launcherName);
  const content =
    input.platform === "win32"
      ? buildCmdLauncherContent(input.nodeExecutable, input.entry)
      : buildPosixLauncherContent(input.nodeExecutable, input.entry);
  await writeFile(launcherPath, content, "utf8");
  if (input.platform === "darwin") {
    await chmod(launcherPath, 0o755);
  }
  return launcherPath;
}

export interface PnpmLauncherInput {
  readonly toolsDir: string;
  readonly nodeExecutable: string;
  readonly pnpmEntry: string;
  readonly platform: NodeJS.Platform;
}

export function writePnpmLauncher(input: PnpmLauncherInput): Promise<string | null> {
  return writeCmdLauncher({
    toolsDir: input.toolsDir,
    launcherName: input.platform === "win32" ? PNPM_CMD_NAME : PNPM_POSIX_NAME,
    nodeExecutable: input.nodeExecutable,
    entry: input.pnpmEntry,
    platform: input.platform,
  });
}

export interface DshLauncherInput {
  readonly toolsDir: string;
  readonly nodeExecutable: string;
  readonly dshBin: string;
  readonly platform: NodeJS.Platform;
}

export function writeDshLauncher(input: DshLauncherInput): Promise<string | null> {
  return writeCmdLauncher({
    toolsDir: input.toolsDir,
    launcherName: input.platform === "win32" ? DSH_CMD_NAME : DSH_POSIX_NAME,
    nodeExecutable: input.nodeExecutable,
    entry: input.dshBin,
    platform: input.platform,
  });
}
