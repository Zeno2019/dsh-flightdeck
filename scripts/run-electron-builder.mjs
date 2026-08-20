import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveReleaseMetadata } from "./release-metadata.mjs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const electronBuilderCli = require.resolve("electron-builder/cli.js");

function readDshVersion() {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  return deriveReleaseMetadata(packageJson).dshVersion;
}

export function runElectronBuilder(args = process.argv.slice(2)) {
  const dshVersion = readDshVersion();
  const result = spawnSync(process.execPath, [electronBuilderCli, ...args], {
    env: {
      ...process.env,
      DSH_VERSION: dshVersion,
    },
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (typeof result.status === "number") {
    return result.status;
  }
  if (result.signal !== null) {
    console.error(`electron-builder terminated by ${result.signal}`);
  }
  return 1;
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  try {
    process.exitCode = runElectronBuilder();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
