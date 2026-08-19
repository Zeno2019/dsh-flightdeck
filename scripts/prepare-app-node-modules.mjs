// Prepares the production node_modules tree that build.files injects into
// resources/app/node_modules.
//
// electron-builder's built-in dependency collector spawns `npm list` over
// the repository root and intermittently hangs there for 15-20 minutes on
// Windows CI runners (the packaging log freezes right after the
// "searching for node modules" line; 3 runs, 2 hangs, same code). The
// before-build hook (scripts/before-build.cjs) returns false, which marks
// the dependencies as handled externally and makes electron-builder skip
// the collector entirely — package.json build.files then copies this
// pre-installed tree into the app bundle as a plain file set
// ({ from: "build/app-prod/node_modules", to: "node_modules" }). No npm
// list traversal, no dev-dependency leakage, deterministic on every runner.
//
// npm lifecycle scripts of the production dependencies run inside this
// directory exactly as they would in a root install. A few of them
// produce artifacts the app cannot work without (the vendored node
// executable, node-pty's conpty assets, the spawn-helper exec bit), so
// each is replayed below when its artifact is missing — script-blocking
// npm policies on future runners must not silently ship a broken tree.
// koffi's native binary needs no script at all: it ships as the npm
// optional dependency @koromix/koffi-<platform>-<arch>, verified in 6b.

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PROD_DIR = join(REPOSITORY_ROOT, "build", "app-prod");
const APP_PROD_NODE_MODULES = join(APP_PROD_DIR, "node_modules");
const NODE_BINARY = join("node_modules", "node", "bin", process.platform === "win32" ? "node.exe" : "node");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  console.error(`prepare-app-node-modules: ${message}`);
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error !== undefined) {
    fail(`${command} ${args.join(" ")} could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

function listScopePackages(nodeModulesRoot) {
  const scope = join(nodeModulesRoot, "@deepseek-ai");
  return readdirSync(scope)
    .filter((name) => !name.startsWith("."))
    .sort();
}

function findKoffiBinaries() {
  // koffi ships its prebuilt binary as an npm optional dependency
  // (@koromix/koffi-<platform>-<arch>); the cnoke install script is only
  // a source-compile fallback for platforms without one. The build/koffi
  // path is kept for source builds.
  const hits = [];
  const searchRoots = [
    join(APP_PROD_NODE_MODULES, "@koromix", `koffi-${process.platform}-${process.arch}`),
    join(APP_PROD_NODE_MODULES, "koffi", "build"),
  ];
  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "koffi.node") hits.push(full);
      }
    };
    walk(root);
  }
  return hits;
}

console.time("prepare-app-node-modules");

// 1. Reset the staging directory so reruns are idempotent.
if (existsSync(APP_PROD_DIR)) {
  rmSync(APP_PROD_DIR, { recursive: true, force: true });
}
mkdirSync(APP_PROD_DIR, { recursive: true });

// 2. Install the production tree from the repository lockfile. The copied
//    manifest drops the root `scripts` section: `postinstall` would run
//    patch-package from this directory, but patch-package is a
//    devDependency (omitted) — the patch is replayed manually in step 4.
const rootManifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));
const { scripts: _rootScripts, ...installManifest } = rootManifest;
writeFileSync(join(APP_PROD_DIR, "package.json"), `${JSON.stringify(installManifest, null, 2)}\n`, "utf8");
copyFileSync(join(REPOSITORY_ROOT, "package-lock.json"), join(APP_PROD_DIR, "package-lock.json"));
cpSync(join(REPOSITORY_ROOT, "patches"), join(APP_PROD_DIR, "patches"), { recursive: true });

run(npmExecutable, ["ci", "--omit=dev", "--no-audit", "--no-fund"], APP_PROD_DIR);

// 3. Replay lifecycle scripts whose artifacts are missing. npm ci runs
//    them under current npm policies; the replays only fire when a policy
//    skipped them, keeping the tree correct on every runner.

// 3a. node's preinstall downloads the platform binary via node-bin-setup
//     (npm install --no-save node-bin-<platform>-<arch> inside the
//     package; the linked bin lands in node_modules/node/bin).
if (!existsSync(join(APP_PROD_DIR, NODE_BINARY))) {
  run(process.execPath, ["installArchSpecificPackage.js"], join(APP_PROD_NODE_MODULES, "node"));
}

// 3b. koffi's prebuilt binary normally arrives as the optional dependency
//     @koromix/koffi-<platform>-<arch>, so the install script is only a
//     source-compile fallback. If no binary landed, retry the build once
//     (without --prebuild, whose probe passes without the binary).
if (findKoffiBinaries().length === 0) {
  run(
    process.execPath,
    ["./cnoke.cjs", "build", "-P", ".", "-D", "src/koffi", "--release"],
    join(APP_PROD_NODE_MODULES, "koffi"),
  );
  if (findKoffiBinaries().length === 0) {
    fail("koffi native binary (koffi.node) still missing after source-build replay");
  }
}

// 3c. node-pty's postinstall copies conpty.dll/OpenConsole.exe on Windows.
const conptyAssets = join(APP_PROD_NODE_MODULES, "node-pty", "build", "Release", "conpty", "conpty.dll");
if (process.platform === "win32" && !existsSync(conptyAssets)) {
  run(process.execPath, ["node_modules/node-pty/scripts/post-install.js"], APP_PROD_DIR);
}

// 3d. dsh-subprocess-local's postinstall restores the exec bit on
//     node-pty's spawn-helper (stripped from the npm tarball on POSIX).
if (process.platform !== "win32") {
  const helper = join(
    APP_PROD_NODE_MODULES,
    "node-pty",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  if (existsSync(helper)) {
    let executable = true;
    try {
      accessSync(helper, constants.X_OK);
    } catch {
      executable = false;
    }
    if (!executable) {
      run(
        process.execPath,
        ["node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs"],
        APP_PROD_DIR,
      );
    }
  }
}

// 4. Replay the @deepseek-ai patches with the root install's patch-package
//    (a devDependency, deliberately absent from this production tree).
run(
  process.execPath,
  ["../../node_modules/patch-package/index.js", "--patch-dir", "patches", "--error-on-fail"],
  APP_PROD_DIR,
);

// 5. Strip npm-only metadata the app does not need: `.bin` shims are
//    symlinks on POSIX (junction material the installer must never carry)
//    and cmd shims on Windows, and `.package-lock.json` is installer
//    metadata.
for (const entry of [".bin", ".package-lock.json"]) {
  rmSync(join(APP_PROD_NODE_MODULES, entry), { recursive: true, force: true });
}

// 6. Hard assertions: fail loudly instead of shipping a broken tree.

// 6a. The vendored node executable the harness spawns at runtime.
if (!existsSync(join(APP_PROD_DIR, NODE_BINARY))) {
  fail(`vendored node binary missing: ${NODE_BINARY}`);
}

// 6b. The koffi native binary must be present (optional dependency or
//     source build).
if (findKoffiBinaries().length === 0) {
  fail("koffi native binary (koffi.node) missing from the staged node_modules");
}

// 6c. The NTFS junction patch must be applied (the patched file carries
//     the patch-only markers readlinkSync/isManagedFallbackLink).
const bootIndex = join(APP_PROD_NODE_MODULES, "@deepseek-ai", "dsh-app-boot", "lib", "index.js");
if (!existsSync(bootIndex)) {
  fail("expected @deepseek-ai/dsh-app-boot/lib/index.js in the staged node_modules");
}
const bootSource = readFileSync(bootIndex, "utf8");
if (!bootSource.includes("readlinkSync") || !bootSource.includes("isManagedFallbackLink")) {
  fail("dsh-app-boot NTFS junction patch was not applied (expected readlinkSync/isManagedFallbackLink)");
}

// 6d. The @deepseek-ai production closure must match the root install:
//     the root tree contains exactly the production closure of the app's
//     dependencies, so the two package sets must be identical.
const rootScope = listScopePackages(join(REPOSITORY_ROOT, "node_modules"));
const appScope = listScopePackages(APP_PROD_NODE_MODULES);
const missing = rootScope.filter((name) => !appScope.includes(name));
const extra = appScope.filter((name) => !rootScope.includes(name));
if (missing.length > 0 || extra.length > 0) {
  const lines = [
    ...missing.map((name) => `  missing from app-prod (present in root): @deepseek-ai/${name}`),
    ...extra.map((name) => `  extra in app-prod (absent from root): @deepseek-ai/${name}`),
  ];
  fail(
    `@deepseek-ai closure mismatch (${rootScope.length} in root vs ${appScope.length} in app-prod):\n${lines.join("\n")}`,
  );
}

console.timeEnd("prepare-app-node-modules");
console.log(`prepare-app-node-modules: staged ${appScope.length} @deepseek-ai packages`);
