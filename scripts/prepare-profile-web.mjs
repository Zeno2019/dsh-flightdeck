// Builds the vendored web profile that the packaged app seeds into a fresh
// DSH_HOME on first launch.
//
// The upstream DSH runtime auto-initializes the `web` profile from a
// template with empty dependencies, and `dsh plugin` is its only supported
// installer (pnpm + network on the target machine). Shipping a prepared
// profile instead keeps the desktop app offline-capable for the two
// approved plugins. npm's flat node_modules layout contains no symlinks,
// so the staged tree is safe for the NSIS installer (no junction material).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_DIR = join(REPOSITORY_ROOT, "build", "profile-web");

// The profile manifest mirrors the user-facing web profile shape: the two
// template bundles that DSH ships, plus the two approved plugins.
const PROFILE_MANIFEST = {
  name: "dsh-profile-web",
  private: true,
  dependencies: {
    dshmarket: "1.14.1",
    "dsh-find-plugin": "0.3.6",
  },
  dsh: {
    profile: {
      bundles: [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "dsh-find-plugin",
      ],
    },
  },
};

function fail(message) {
  console.error(`prepare-profile-web: ${message}`);
  process.exit(1);
}

// 1. Reset the staging directory so reruns are idempotent.
if (existsSync(STAGING_DIR)) {
  rmSync(STAGING_DIR, { recursive: true, force: true });
}
mkdirSync(STAGING_DIR, { recursive: true });

// 2. Write the profile manifest and the empty patch layer that DSH's
//    template initialization would create.
writeFileSync(
  join(STAGING_DIR, "package.json"),
  `${JSON.stringify(PROFILE_MANIFEST, null, 2)}\n`,
  "utf8",
);
writeFileSync(join(STAGING_DIR, "cordis.patch.yml"), "[]\n", "utf8");

// 3. Install the two pinned plugin production trees. Peer dependencies
//    are deliberately NOT installed: the plugins' @deepseek-ai peers
//    resolve at runtime from the packaged dsh closure (healed into
//    $DSH_HOME/profiles/node_modules by dsh-app-boot), exactly like a
//    pnpm-managed profile. Vendoring them here would duplicate the closure
//    and npm's peer auto-installation would resolve mismatched rc sets.
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawnSync(
  npmExecutable,
  ["install", "--omit=dev", "--save-exact", "--no-audit", "--no-fund", "--legacy-peer-deps"],
  {
    cwd: STAGING_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
if (install.error !== undefined) {
  fail(`npm install could not run: ${install.error.message}`);
}
if (install.status !== 0) {
  fail(`npm install exited with code ${install.status}`);
}

// 4. Strip npm-only metadata that the profile does not need: the `.bin`
//    shims are symlinks on POSIX (junction material the installer must
//    never carry) and `.package-lock.json` is installer metadata.
for (const entry of [".bin", ".package-lock.json"]) {
  rmSync(join(STAGING_DIR, "node_modules", entry), { recursive: true, force: true });
}

// 5. Prove the two approved plugins landed before the installer consumes
//    the staging directory.
for (const plugin of ["dshmarket", "dsh-find-plugin"]) {
  if (!existsSync(join(STAGING_DIR, "node_modules", plugin, "package.json"))) {
    fail(`expected ${plugin} in the staged node_modules`);
  }
}

console.log("prepare-profile-web: staged dshmarket@1.14.1 and dsh-find-plugin@0.3.6");
