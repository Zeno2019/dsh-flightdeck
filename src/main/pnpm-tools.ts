import { mkdir, writeFile } from "node:fs/promises";
import path, { join } from "node:path";

/**
 * Vendored pnpm launcher for the DSH market's one-click pnpm setup.
 *
 * dshmarket@1.14.1 probes the child PATH for a working `pnpm`
 * (dsh-cli.js `provisionPnpm`: corepack first, then npm -g, with
 * `probePnpm` — `pnpm --version` — as the success gate after each step,
 * and its `spawnEnv` keeps the inherited PATH). A `pnpm.cmd` on the PATH
 * the harness hands DSH therefore short-circuits the whole probe without
 * npm or corepack ever existing on the host machine.
 *
 * The launcher targets the node binary resolved by `runtime-paths`
 * (`node_modules/node/bin/node.exe`), never `process.execPath` — inside
 * Electron that is the Electron binary itself. It is rewritten on every
 * startup, so an upgraded app never leaves a stale absolute path behind.
 *
 * Only win32 needs it: the product packages Windows only, and dev macOS
 * machines carry their own pnpm on PATH.
 */

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

/**
 * A cmd.exe launcher: UTF-8 console first (`@chcp 65001` — pnpm diagnostics
 * would otherwise arrive as GBK garbage on Chinese Windows, the same garbled
 * "not an internal or external command" text seen in the 0.1.0-rc.2 market
 * log), then the vendored node running the vendored pnpm entry.
 */
export function buildPnpmLauncherContent(nodeExecutable: string, pnpmEntry: string): string {
  return `@chcp 65001 >nul\n@"${nodeExecutable}" "${pnpmEntry}" %*\n`;
}

export interface PnpmLauncherInput {
  readonly toolsDir: string;
  readonly nodeExecutable: string;
  readonly pnpmEntry: string;
  readonly platform: NodeJS.Platform;
}

/**
 * Materializes `<toolsDir>/pnpm.cmd` for win32 and returns its path; a no-op
 * (null) on every other platform. Failures propagate to the caller, which
 * degrades to an uninjected PATH instead of blocking startup.
 */
export async function writePnpmLauncher(input: PnpmLauncherInput): Promise<string | null> {
  if (input.platform !== "win32") return null;
  await mkdir(input.toolsDir, { recursive: true });
  const launcherPath = join(input.toolsDir, "pnpm.cmd");
  await writeFile(launcherPath, buildPnpmLauncherContent(input.nodeExecutable, input.pnpmEntry), "utf8");
  return launcherPath;
}
