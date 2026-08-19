import { mkdir, writeFile } from "node:fs/promises";
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
 * (`node_modules/node/bin/node.exe`), never `process.execPath` — inside
 * Electron that is the Electron binary itself. Launchers are rewritten on
 * every startup, so an upgraded app never leaves a stale absolute path
 * behind. Only win32 gets launchers: the product packages Windows only, and
 * dev macOS machines carry their own tooling on PATH.
 */

const PNPM_LAUNCHER_NAME = "pnpm.cmd" as const;
const DSH_LAUNCHER_NAME = "dsh.cmd" as const;

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
 * The pnpm package entry shipped inside the app closure. pnpm@11.7.0 is a
 * dependency-free JS package (engines node >=22.13, satisfied by the
 * vendored node@24.19.0), so electron-builder's production collector ships
 * it like any other direct dependency.
 */
export function resolvePnpmEntry(appRoot: string, platform: NodeJS.Platform): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(appRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
}

export function buildPnpmLauncherContent(nodeExecutable: string, pnpmEntry: string): string {
  return buildCmdLauncherContent(nodeExecutable, pnpmEntry);
}

/** Launcher for the DSH CLI entry resolved by runtime-paths (`dshBin`). */
export function buildDshLauncherContent(nodeExecutable: string, dshBin: string): string {
  return buildCmdLauncherContent(nodeExecutable, dshBin);
}

interface CmdLauncherInput {
  readonly toolsDir: string;
  readonly launcherName: string;
  readonly nodeExecutable: string;
  readonly entry: string;
  readonly platform: NodeJS.Platform;
}

/**
 * Materializes `<toolsDir>/<launcherName>` for win32 and returns its path; a
 * no-op (null) on every other platform. Failures propagate to the caller,
 * which degrades to an uninjected PATH instead of blocking startup.
 */
async function writeCmdLauncher(input: CmdLauncherInput): Promise<string | null> {
  if (input.platform !== "win32") return null;
  await mkdir(input.toolsDir, { recursive: true });
  const launcherPath = join(input.toolsDir, input.launcherName);
  await writeFile(launcherPath, buildCmdLauncherContent(input.nodeExecutable, input.entry), "utf8");
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
    launcherName: PNPM_LAUNCHER_NAME,
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
    launcherName: DSH_LAUNCHER_NAME,
    nodeExecutable: input.nodeExecutable,
    entry: input.dshBin,
    platform: input.platform,
  });
}
