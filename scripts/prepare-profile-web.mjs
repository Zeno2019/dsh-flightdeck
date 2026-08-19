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
// node_modules must sit one level below the copied root: electron-builder
// drops a root-level node_modules of an extraResources source directory
// (dsh-cockpit's electron-builder.yml documents the same exclusion), so the
// seed payload nests under payload/ while the extraResources source root
// stays node_modules-free.
const PAYLOAD_DIR = join(STAGING_DIR, "payload");

// The pnpm settings DSH's own profile template writes on first use
// (`@deepseek-ai/dsh-app-boot` PROFILE_PNPM_WORKSPACE). `autoInstallPeers:
// false` is the load-bearing line: without it, pnpm's default peer
// auto-install walks the seeded plugins' @deepseek-ai peer ranges straight
// into restricted (private) 0.0.1-rc.x packages and every market install
// dies with an unresolvable dependency — the 0.1.0-rc.4 real-machine
// failure. The seeded plugins' peers are supplied at runtime by the
// packaged DSH closure healed into $DSH_HOME/profiles/node_modules.
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;

// The profile manifest mirrors the user-facing web profile shape: the two
// template bundles that DSH ships, plus the two approved plugins.
// dsh-find-plugin is pinned to 0.3.7 (not 0.3.6): 0.3.6's peer range
// `@deepseek-ai/dsh-tools@^0.0.1-rc.1` resolves only to restricted
// registry line; 0.3.7 moved the peer to the public `^0.1.0-rc.6` line.
const PROFILE_MANIFEST = {
  name: "dsh-profile-web",
  private: true,
  dependencies: {
    dshmarket: "1.14.1",
    "dsh-find-plugin": "0.3.7",
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
mkdirSync(PAYLOAD_DIR, { recursive: true });

// 2. Write the profile manifest and the empty patch layer that DSH's
//    template initialization would create.
writeFileSync(
  join(PAYLOAD_DIR, "package.json"),
  `${JSON.stringify(PROFILE_MANIFEST, null, 2)}\n`,
  "utf8",
);
writeFileSync(join(PAYLOAD_DIR, "cordis.patch.yml"), "[]\n", "utf8");
writeFileSync(join(PAYLOAD_DIR, "pnpm-workspace.yaml"), PROFILE_PNPM_WORKSPACE, "utf8");

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
    cwd: PAYLOAD_DIR,
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
//    never carry) and both lockfiles are installer metadata.
for (const entry of [".bin", ".package-lock.json"]) {
  rmSync(join(PAYLOAD_DIR, "node_modules", entry), { recursive: true, force: true });
}
rmSync(join(PAYLOAD_DIR, "package-lock.json"), { force: true });

// 5. Prove the two approved plugins landed before the installer consumes
//    the staging directory.
for (const plugin of ["dshmarket", "dsh-find-plugin"]) {
  if (!existsSync(join(PAYLOAD_DIR, "node_modules", plugin, "package.json"))) {
    fail(`expected ${plugin} in the staged node_modules`);
  }
}

console.log("prepare-profile-web: staged dshmarket@1.14.1 and dsh-find-plugin@0.3.7");
