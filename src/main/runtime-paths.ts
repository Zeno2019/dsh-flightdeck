import path from "node:path";

export type RuntimeMode = "dev" | "packaged";

export interface RuntimePathInput {
  readonly mode: RuntimeMode;
  readonly platform: NodeJS.Platform;
  readonly appRoot: string;
}

export interface ResolvedRuntimePaths {
  readonly nodeExecutable: string;
  readonly dshBin: string;
  readonly runtimeEntry: string;
  readonly assetsDir: string;
}

/**
 * Resolves the bundled Node binary, the DSH CLI entry, and the runtime entry.
 * Win32 uses win32 path semantics and node.exe; every other platform uses
 * POSIX semantics and the bare node binary. Dev assets live in appRoot/build;
 * packaged assets are installed beside appRoot under resources.
 */
export function resolveRuntimePaths(input: RuntimePathInput): ResolvedRuntimePaths {
  const p = input.platform === "win32" ? path.win32 : path.posix;
  const nodeExecutable = p.join(
    input.appRoot,
    "node_modules",
    "node",
    "bin",
    input.platform === "win32" ? "node.exe" : "node",
  );
  const dshBin = p.join(input.appRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const assetsDir = input.mode === "dev" ? p.join(input.appRoot, "build") : p.dirname(input.appRoot);
  return {
    nodeExecutable,
    dshBin,
    runtimeEntry: p.join(assetsDir, "runtime-node-entry.mjs"),
    assetsDir,
  };
}
