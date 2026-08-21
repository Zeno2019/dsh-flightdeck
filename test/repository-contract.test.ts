import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  lockEntryVersion,
  parsePackageJson,
  parsePackageLock,
  readBoolean,
  readRecord,
  readRecordArray,
  readString,
  readStringArray,
  requiredString,
} from "./repository-reader";

// The test file lives in test/, so the repository root is one directory up.
const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(join(REPOSITORY_ROOT, relativePath), "utf8");
}

describe("package.json", () => {
  it("declares the exact v0.1.3 package identity and Apache-2.0 license", async () => {
    // Given: the repository package.json
    // When: parsed into a typed shape
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // Then: identity matches the initialization plan review decisions
    expect(pkg.name).toBe("dsh-flightdeck");
    expect(pkg.version).toBe("0.1.3");
    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.main).toBe("./out/main/index.js");
  });

  it("keeps the Electron and builder product names aligned", async () => {
    // Given: the package metadata consumed by Electron and electron-builder
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // When: both product-name sources are read
    const builderProductName = readString(pkg.build, "productName");

    // Then: Electron derives the same packaged userData directory expected by the builder contract
    expect(pkg.productName).toBe("DSH Flightdeck");
    expect(pkg.productName).toBe(builderProductName);
  });

  it("pins the exact runtime dependencies", async () => {
    // Given: the parsed package.json
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // When: the four pinned runtime inputs are read
    // Then: each resolves to its exact section 5.1 version
    expect(requiredString(pkg.dependencies, "@deepseek-ai/dsh")).toBe("0.1.0-rc.7");
    expect(requiredString(pkg.dependencies, "node")).toBe("24.19.0");
    expect(requiredString(pkg.dependencies, "pnpm")).toBe("11.8.0");
    expect(requiredString(pkg.dependencies, "ts-pattern")).toBe("5.9.0");
  });

  it("declares the DSH runtime peer closure as direct dependencies", async () => {
    // Given: the parsed package.json
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // When: the peer-only DSH packages are read
    // Then: each is a direct dependency, because electron-builder's production
    // collector drops packages reachable only through peerDependencies and the
    // installed app then fails with ERR_MODULE_NOT_FOUND at boot
    const closure: Record<string, string> = {
      "@deepseek-ai/cordis-plugin-group": "1.0.1",
      "@deepseek-ai/dsh-anonymous-user-id": "0.1.0-rc.7",
      "@deepseek-ai/dsh-atomic-write": "0.1.0-rc.7",
      "@deepseek-ai/dsh-bash-local": "0.1.0-rc.7",
      "@deepseek-ai/dsh-code-runtime": "0.1.0-rc.7",
      "@deepseek-ai/dsh-compaction": "0.1.0-rc.7",
      "@deepseek-ai/dsh-fs": "0.1.0-rc.7",
      "@deepseek-ai/dsh-invariants": "0.1.0-rc.7",
      "@deepseek-ai/dsh-output-retention": "0.1.0-rc.7",
      "@deepseek-ai/dsh-sandbox": "0.1.0-rc.7",
      "@deepseek-ai/dsh-scope": "0.1.0-rc.7",
      "@deepseek-ai/dsh-session-telemetry": "0.1.0-rc.7",
      "@deepseek-ai/dsh-session-title-llm": "0.1.0-rc.7",
      "@deepseek-ai/dsh-shell": "0.1.0-rc.7",
      "@deepseek-ai/dsh-spill": "0.1.0-rc.7",
      "@deepseek-ai/dsh-subagent-in-process-driver": "0.1.0-rc.7",
      "@deepseek-ai/dsh-subprocess": "0.1.0-rc.7",
      "@deepseek-ai/dsh-timeout": "0.1.0-rc.7",
      "@deepseek-ai/dsh-workflow": "0.1.0-rc.7",
    };
    for (const [name, version] of Object.entries(closure)) {
      expect(requiredString(pkg.dependencies, name)).toBe(version);
    }
  });

  it("pins the exact development toolchain", async () => {
    // Given: the parsed package.json
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // When: the seven devDependencies are read
    // Then: each resolves to its exact section 5.1 version plus the patch runner
    expect(requiredString(pkg.devDependencies, "electron")).toBe("43.4.0");
    expect(requiredString(pkg.devDependencies, "electron-builder")).toBe("26.15.3");
    expect(requiredString(pkg.devDependencies, "electron-vite")).toBe("5.0.0");
    expect(requiredString(pkg.devDependencies, "patch-package")).toBe("8.0.1");
    expect(requiredString(pkg.devDependencies, "typescript")).toBe("5.9.3");
    expect(requiredString(pkg.devDependencies, "vitest")).toBe("4.1.10");
    expect(requiredString(pkg.devDependencies, "@types/node")).toBe("24.10.1");
  });

  it("reinstalls the Windows junction repair through a pinned patch-package postinstall", async () => {
    // Given: the parsed package.json and the patches directory
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));
    const patchFiles = await readdir(join(REPOSITORY_ROOT, "patches"));
    const patchPath = patchFiles.find((name) => name.startsWith("@deepseek-ai+dsh-app-boot+0.1.0-rc.7"));
    expect(patchPath).toBeDefined();
    const patch = await readRepositoryFile(join("patches", patchPath ?? "missing.patch"));

    // When: the repair seam is inspected
    // Then: postinstall applies it and the patch replaces junction-incompatible removal
    expect(requiredString(pkg.scripts, "postinstall")).toBe("patch-package");
    expect(patch).toContain("rmdirSync");
    expect(patch).toContain("junction");
    expect(patch).toContain("isManagedFallbackLink");
  });

  it("declares no auto-update dependency", async () => {
    // Given: the parsed package.json
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // When: auto-update is looked up in both dependency lists
    // Then: electron-updater is absent from both
    expect(pkg.dependencies["electron-updater"]).toBeUndefined();
    expect(pkg.devDependencies["electron-updater"]).toBeUndefined();
  });

  it("declares the required script contract with never-publishing packaging", async () => {
    // Given: the parsed package.json scripts
    const scripts = parsePackageJson(await readRepositoryFile("package.json")).scripts;

    // When: the six required script names are read
    const requiredScripts = ["dev", "build", "typecheck", "test", "package:dir", "package:win"] as const;
    for (const name of requiredScripts) {
      expect(requiredString(scripts, name).length).toBeGreaterThan(0);
    }

    // Then: both packaging commands verify the Windows target and never publish
    expect(requiredString(scripts, "package:dir")).toContain("verify:target:win");
    expect(requiredString(scripts, "package:dir")).toContain("prepare-profile-web.mjs");
    expect(requiredString(scripts, "package:dir")).toContain("npm run prepare:app");
    expect(requiredString(scripts, "package:dir")).toContain("--publish never");
    expect(requiredString(scripts, "package:dir")).toContain("node scripts/run-electron-builder.mjs");
    expect(requiredString(scripts, "package:win")).toContain("verify:target:win");
    expect(requiredString(scripts, "package:win")).toContain("prepare-profile-web.mjs");
    expect(requiredString(scripts, "package:win")).toContain("npm run prepare:app");
    expect(requiredString(scripts, "package:win")).toContain("--publish never");
    expect(requiredString(scripts, "package:win")).toContain("node scripts/run-electron-builder.mjs");
    expect(requiredString(scripts, "package:mac")).toContain("npm run prepare:app");
    expect(requiredString(scripts, "package:mac")).toContain("node scripts/run-electron-builder.mjs");
    expect(requiredString(scripts, "package:mac:dir")).toContain("npm run prepare:app");
    expect(requiredString(scripts, "package:mac:dir")).toContain("node scripts/run-electron-builder.mjs");
  });

  it("declares the exact Windows x64 NSIS builder contract", async () => {
    // Given: the untrusted build object parsed from package.json
    const build = parsePackageJson(await readRepositoryFile("package.json")).build;

    // When: every machine-consumed packaging field is narrowed
    const extraResources = readRecordArray(build, "extraResources").map((resource) => ({
      from: readString(resource, "from"),
      to: readString(resource, "to"),
    }));
    const targets = readRecordArray(readRecord(build, "win"), "target");
    const target = targets[0];
    if (target === undefined) throw new TypeError("expected one Windows target");
    const nsis = readRecord(build, "nsis");

    // Then: the builder can only produce the approved unsigned filesystem installer
    expect(readString(build, "appId")).toBe("dev.zeno.dsh-flightdeck");
    expect(readString(build, "productName")).toBe("DSH Flightdeck");
    expect(readBoolean(build, "asar")).toBe(false);
    // npmRebuild must NOT be false: electron-builder 26.x short-circuits
    // installAppDependencies before consulting the beforeBuild hook when it
    // is (packager.js:454-457), which would leave the collector enabled.
    expect(build["npmRebuild"]).toBeUndefined();
    expect(readString(build, "beforeBuild")).toBe("scripts/before-build.cjs");
    expect(readString(build, "compression")).toBe("normal");
    expect(build["files"]).toEqual([
      "out/**/*",
      { from: "build/app-prod/node_modules", to: "node_modules" },
      "package.json",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "!**/*.map",
      "!**/.gitmodules",
    ]);
    expect(extraResources).toEqual([
      { from: "build/splash.html", to: "splash.html" },
      { from: "build/runtime-node-entry.mjs", to: "runtime-node-entry.mjs" },
      { from: "build/profile-web", to: "profile-web" },
    ]);
    expect(targets).toHaveLength(1);
    expect(readString(target, "target")).toBe("nsis");
    expect(readStringArray(target, "arch")).toEqual(["x64"]);
    expect({
      oneClick: readBoolean(nsis, "oneClick"),
      perMachine: readBoolean(nsis, "perMachine"),
      allowToChangeInstallationDirectory: readBoolean(nsis, "allowToChangeInstallationDirectory"),
      createDesktopShortcut: readBoolean(nsis, "createDesktopShortcut"),
      createStartMenuShortcut: readBoolean(nsis, "createStartMenuShortcut"),
      artifactName: readString(nsis, "artifactName"),
    }).toEqual({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      artifactName: "dsh-flightdeck-${version}-dsh-${env.DSH_VERSION}-windows-${arch}-setup.${ext}",
    });
    for (const forbiddenKey of ["publish", "linux", "electronUpdaterCompatibility"] as const) {
      expect(build[forbiddenKey]).toBeUndefined();
    }
  });

  it("declares the exact unsigned macOS arm64 dmg builder contract", async () => {
    // Given: the untrusted build object parsed from package.json
    const build = parsePackageJson(await readRepositoryFile("package.json")).build;

    // When: every machine-consumed macOS packaging field is narrowed
    const mac = readRecord(build, "mac");
    const targets = readRecordArray(mac, "target");
    const target = targets[0];
    if (target === undefined) throw new TypeError("expected one macOS target");

    // Then: the builder can only produce the approved unsigned arm64 dmg.
    // identity: null keeps signing off (CI sets CSC_IDENTITY_AUTO_DISCOVERY
    // to false as the second belt), and the artifact name mirrors the win one.
    expect(mac["identity"]).toBeNull();
    expect(targets).toHaveLength(1);
    expect(readString(target, "target")).toBe("dmg");
    expect(readStringArray(target, "arch")).toEqual(["arm64"]);
    expect(readString(mac, "artifactName")).toBe("dsh-flightdeck-${version}-dsh-${env.DSH_VERSION}-mac-${arch}.${ext}");
    expect(readString(mac, "category")).toBe("public.app-category.developer-tools");
  });

  it("routes every package build through the metadata-aware electron-builder wrapper", async () => {
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));
    const metadata = await readRepositoryFile("scripts/release-metadata.mjs");
    const wrapper = await readRepositoryFile("scripts/run-electron-builder.mjs");

    for (const name of ["package:dir", "package:win", "package:mac:dir", "package:mac"] as const) {
      const script = requiredString(pkg.scripts, name);
      expect(script).toContain("node scripts/run-electron-builder.mjs");
      expect(script).toContain("--publish never");
    }
    expect(metadata).toContain('dependencies["@deepseek-ai/dsh"]');
    expect(metadata).toContain("RELEASE_TAG");
    expect(metadata).toContain("GITHUB_OUTPUT");
    expect(metadata).toContain('releaseNotesPath = join("docs", "releases", `${expectedTag}.md`)');
    expect(metadata).toContain('release_notes_path", "releaseNotesPath"');
    expect(wrapper).toContain('electron-builder/cli.js');
    expect(wrapper).toContain("DSH_VERSION");
    expect(wrapper).toContain("process.execPath");
  });

  it("ships vendored pnpm and dsh launchers and injects their win32 tools directory into the harness PATH", async () => {
    // Given: the launcher module, the spawn seam, and the startup wiring
    const toolLaunchers = await readRepositoryFile("src/main/tool-launchers.ts");
    const runtime = await readRepositoryFile("src/main/runtime.ts");
    const index = await readRepositoryFile("src/main/index.ts");

    // Then: both win32 launchers switch the console to UTF-8 (the 0.1.0-rc.2
    // market log garbled tool failures as GBK) and run their vendored entry
    // with the vendored node, never process.execPath (the Electron binary)
    expect(toolLaunchers).toContain('@chcp 65001 >nul');
    expect(toolLaunchers).toContain('"pnpm.cmd"');
    expect(toolLaunchers).toContain('"dsh.cmd"');
    expect(toolLaunchers).toContain('"pnpm", "bin", "pnpm.cjs"');
    expect(toolLaunchers).toContain("buildDshLauncherContent");
    expect(toolLaunchers).toContain("writeDshLauncher");
    expect(toolLaunchers).toContain('input.platform !== "win32"');
    expect(toolLaunchers).toContain("never `process.execPath`");

    // Then: the harness child PATH accepts prepended directories merged into
    // a single case-insensitive-safe PATH key
    expect(runtime).toContain("withPrependedPath");
    expect(runtime).toContain("prependPathDirs");
    expect(runtime).toContain("env[\"Path\"]");

    // Then: startup materializes both launchers under userData/tools from
    // runtime-paths inputs, injects the directory, and degrades instead of
    // blocking when a write fails
    expect(index).toContain("writePnpmLauncher(");
    expect(index).toContain("writeDshLauncher(");
    expect(index).toContain("resolvePnpmEntry(app.getAppPath(), process.platform)");
    expect(index).toContain("dshBin: paths.dshBin");
    expect(index).toContain('join(userData, "tools")');
    expect(index).toContain("prependPathDirs.push(toolsDir)");
    expect(index).toContain('reportMainFailure("tool launchers", error)');
  });

  it("vendors the four approved DSH plugins as a first-launch web profile seed", async () => {
    // Given: the packaging-time prepare script, ignore rules, and seed seam
    const prepare = await readRepositoryFile("scripts/prepare-profile-web.mjs");
    const gitignore = await readRepositoryFile(".gitignore");
    const seedModule = await readRepositoryFile("src/main/profile-seed.ts");
    const index = await readRepositoryFile("src/main/index.ts");

    // Then: only the four approved plugins are pinned and bundled, and the
    // staged npm tree can never leak into git
    expect(prepare).toContain('dshmarket: "1.14.1"');
    expect(prepare).toContain('"dsh-find-plugin": "0.3.7"');
    expect(prepare).toContain('const ANCHORED_SUBAGENT_SHA = "31fdd22a4265aef3107d9fca05854bea78a9af10"');
    expect(prepare).toContain("https://codeload.github.com/GY-Bai/dsh-anchored-subagent/tar.gz/${ANCHORED_SUBAGENT_SHA}");
    expect(prepare).toContain('"dsh-better-sidebar": "0.13.1"');
    expect(prepare).toContain("pnpm-workspace.yaml");
    expect(prepare).toContain("nodeLinker: hoisted");
    expect(prepare).toContain("autoInstallPeers: false");
    expect(prepare).toContain('"@deepseek-ai/dsh-base"');
    expect(prepare).toContain('"@deepseek-ai/dsh-web-app"');
    expect(prepare).toContain("cordis.patch.yml");
    expect(prepare).toContain('["install", "--omit=dev", "--save-exact", "--no-audit", "--no-fund", "--legacy-peer-deps"]');
    expect(prepare).toContain('for (const entry of [".bin", ".package-lock.json"])');
    expect(prepare).toContain('const PAYLOAD_DIR = join(STAGING_DIR, "payload")');
    expect(prepare).toContain("one level below the copied root");
    expect(gitignore).toContain("/build/profile-web/");

    // Then: the packaged app seeds a fresh DSH_HOME exactly once, keyed on
    // the target manifest, and degrades instead of blocking startup
    expect(seedModule).toContain('join(dshHome, "profiles", "web")');
    expect(seedModule).toContain('join(targetDir, "package.json")');
    expect(index).toContain("seedWebProfile(");
    expect(index).toContain('process.resourcesPath, "profile-web", "payload"');
    expect(index).toContain("app.isPackaged");
  });
});

describe("license and user-visible version disclosure", () => {
  it("ships Apache-2.0 terms, third-party notices, and the tested version matrix", async () => {
    const [license, notices, readme, readmeZh, index, splash, testing, structure] = await Promise.all([
      readRepositoryFile("LICENSE"),
      readRepositoryFile("THIRD_PARTY_NOTICES.md"),
      readRepositoryFile("README.md"),
      readRepositoryFile("README.zh-CN.md"),
      readRepositoryFile("src/main/index.ts"),
      readRepositoryFile("build/splash.html"),
      readRepositoryFile("docs/testing.md"),
      readRepositoryFile("docs/project-structure.md"),
    ]);

    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    for (const component of [
      "@deepseek-ai/dsh",
      "dshmarket",
      "dsh-find-plugin",
      "dsh-anchored-subagent",
      "dsh-better-sidebar",
    ] as const) {
      expect(notices).toContain(component);
    }
    for (const userDocument of [readme, readmeZh]) {
      expect(userDocument).toContain("Flightdeck 0.1.3");
      expect(userDocument).toContain("Apache License 2.0");
      expect(userDocument).not.toMatch(/dsh-flightdeck-\d/);
      expect(userDocument).not.toContain("31fdd22a4265aef3107d9fca05854bea78a9af10");
    }
    expect(readme).toContain("Release testing is limited");
    expect(readme).toContain("no Authenticode signature");
    expect(readme).toContain("Do not disable Gatekeeper globally");
    expect(readmeZh).toContain("发布测试仅覆盖");
    expect(readmeZh).toContain("没有 Authenticode 签名");
    expect(splash).toContain("__FLIGHTDECK_VERSION__");
    expect(splash).toContain("local loopback");
    expect(splash).toContain("DSH/providers/plugins may use network");
    expect(splash).not.toContain(["no", "network"].join(" "));
    expect(testing).toContain("129 tests across 8 files");
    expect(testing).toContain("125 passed, 4 failed");
    expect(testing).toContain("Error: listen EPERM: operation not permitted 127.0.0.1");
    expect(structure).toContain("dsh-flightdeck-0.1.3-dsh-0.1.0-rc.7-windows-x64-setup.exe");
    expect(structure).toContain("Draft Release");
    const trackedReleaseNotes = execFileSync(
      "git",
      ["ls-files", "docs/releases/v0.1.3.md"],
      { cwd: REPOSITORY_ROOT, encoding: "utf8" },
    ).trim();
    expect(trackedReleaseNotes).toBe("");
    expect(index).toContain('join(app.getAppPath(), "node_modules", "@deepseek-ai", "dsh", "package.json")');
    expect(index).toContain('replaceAll("__FLIGHTDECK_VERSION__"');
    expect(index).toContain("app.getVersion()");
  });
});

describe("package-lock.json", () => {
  it("is a lockfileVersion 3 lockfile whose root matches package.json", async () => {
    // Given: both manifests at the repository root
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // When: the lockfile is parsed into a typed shape
    const lock = parsePackageLock(await readRepositoryFile("package-lock.json"));

    // Then: the lockfile version is 3 and root entries agree
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lockEntryVersion(lock, "")).toBe("0.1.3");
  });

  it("locks the exact pinned runtime inputs", async () => {
    // Given: the parsed lockfile
    const lock = parsePackageLock(await readRepositoryFile("package-lock.json"));

    // When: the three runtime entries are read
    // Then: they resolve to the exact section 5.1 versions
    expect(lockEntryVersion(lock, "node_modules/@deepseek-ai/dsh")).toBe("0.1.0-rc.7");
    expect(lockEntryVersion(lock, "node_modules/node")).toBe("24.19.0");
    expect(lockEntryVersion(lock, "node_modules/pnpm")).toBe("11.8.0");
  });
});

describe(".github/workflows/ci.yml", () => {
  it("runs on windows-latest with read-only repository permissions", async () => {
    // Given: the ci workflow file
    const ci = await readRepositoryFile(".github/workflows/ci.yml");

    // When: platform and permission lines are inspected
    // Then: the private validation stage is windows-latest and read-only
    expect(ci).toContain("runs-on: windows-latest");
    expect(ci).toContain("contents: read");
  });

  it("runs the fast development gate without packaging, publishing, or release commands", async () => {
    // Given: the ci workflow file
    const ci = await readRepositoryFile(".github/workflows/ci.yml");

    // When: the executable command lines are inspected
    // Then: the gate covers npm ci, test, typecheck, and build only
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run typecheck");
    expect(ci).toContain("npm run build");
    expect(ci).not.toContain("package:win");
    expect(ci).not.toContain("package:dir");
    expect(ci).not.toContain("publish");
    expect(ci).not.toContain("release");
  });
});

describe(".github/workflows/windows-package.yml", () => {
  it("is a bounded manual Windows package gate with a pinned Node toolchain", async () => {
    // Given: the Windows package workflow
    const workflow = await readRepositoryFile(".github/workflows/windows-package.yml");

    // When: its trigger, permissions, runner, and commands are inspected
    // Then: only the approved manual read-only package gate is present
    expect(workflow).toMatch(/^on:\r?\n  workflow_dispatch:\r?\n\r?\npermissions:/m);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("timeout-minutes: 45");
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("actions/setup-node@v5");
    expect(workflow).toContain("node-version: 24.19.0");
    expect(workflow).toContain("cache: npm");
    expect(workflow).toContain("id: metadata");
    expect(workflow).toContain("node scripts/release-metadata.mjs");
    expect(workflow).toContain("steps.metadata.outputs.windows_artifact_name");
    expect(workflow).toContain("steps.metadata.outputs.windows_path");
    for (const command of ["npm ci", "npm test", "npm run typecheck", "npm run package:win"] as const) {
      expect(workflow).toContain(command);
    }
  });

  it("smokes unpacked and silently installed applications in isolated user-data directories", async () => {
    // Given: the Windows package workflow smoke implementation
    const workflow = await readRepositoryFile(".github/workflows/windows-package.yml");

    // When: process, log-discovery, HTTP, shutdown, and installation seams are inspected
    // Then: both executable forms prove readiness and clean ownership
    expect(workflow).toContain("dist/win-unpacked/DSH Flightdeck.exe");
    expect(workflow).toContain('Join-Path $installDirectory "DSH Flightdeck.exe"');
    expect(workflow).toContain("[desktop] endpoint http://127.0.0.1:");
    expect(workflow).toContain("AddSeconds(180)");
    expect(workflow).toContain("Invoke-WebRequest");
    expect(workflow).toContain("Reduced smoke gate: HTTP 2xx readiness only");
    expect(workflow).toContain("fatal");
    expect(workflow).toContain('uncaught(?:\\s+)?exception');
    expect(workflow).toContain('unhandled(?:\\s+)?rejection');
    expect(workflow).toContain("CloseMainWindow");
    expect(workflow).toMatch(/taskkill\.exe .*\/T \/F/);
    expect(workflow).toContain("$baselineNodePids");
    expect(workflow).toContain("-notin $baselineNodePids");
    expect(workflow).toContain('@("/S", "/D=$installDirectory")');

    // Then: each phase overrides userData so the two phases can never share DSH_HOME state
    expect(workflow).toContain("$env:DSH_FLIGHTDECK_USER_DATA = $UserDataDirectory");
    expect(workflow).toContain('$env:DSH_FLIGHTDECK_USER_DATA = $previousUserDataOverride');
    expect(workflow).toContain("dsh-flightdeck-smoke-win-unpacked");
    expect(workflow).toContain("dsh-flightdeck-smoke-installed");

    // Then: both packaged trees are verified against the repository runtime
    // closure before any smoke, so a dropped peer-only package fails loudly
    expect(workflow).toContain("Assert-PackagedRuntimeClosure");
    expect(workflow).toContain("runtime closure is missing");
    expect(workflow).toContain('Assert-PackagedRuntimeClosure -Label "win-unpacked"');
    expect(workflow).toContain('Assert-PackagedRuntimeClosure -Label "installed"');
    expect(workflow).toContain("Assert-VendoredProfileSeed");
    expect(workflow).toContain("resources/profile-web/payload");
    expect(workflow).toContain('Assert-VendoredProfileSeed -Label "win-unpacked"');
    expect(workflow).toContain('Assert-VendoredProfileSeed -Label "installed"');
    expect(workflow).toContain("vendored profile seed complete (dshmarket, dsh-find-plugin, dsh-anchored-subagent, dsh-better-sidebar)");
    expect(workflow).toContain("vendored profile seed is missing");

    // Then: the vendored pnpm the launcher forwards to is asserted too — the
    // market's one-click setup dies on tooling-free machines without it
    expect(workflow).toContain("Assert-VendoredPnpm");
    expect(workflow).toContain("resources/app/node_modules/pnpm/bin/pnpm.cjs");
    expect(workflow).toContain('Assert-VendoredPnpm -Label "win-unpacked"');
    expect(workflow).toContain('Assert-VendoredPnpm -Label "installed"');
    expect(workflow).toContain("::notice::vendored pnpm 11.8.0 present in packaged tree.");
  });

  it("uploads one setup with strict absence handling and no distribution authority", async () => {
    // Given: the Windows package workflow artifact steps
    const workflow = await readRepositoryFile(".github/workflows/windows-package.yml");

    // When: upload and authority tokens are inspected
    // Then: the setup is mandatory, diagnostics are failure-only, and distribution remains impossible
    expect(workflow).toContain("actions/upload-artifact@v5");
    expect(workflow).toContain("steps.metadata.outputs.windows_artifact_name");
    expect(workflow).toContain("steps.metadata.outputs.windows_path");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("if-no-files-found: warn");
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow).not.toContain("tags:");
    for (const forbiddenToken of ["GH_TOKEN", "secrets.", "gh release", "contents: write", "publish", "signing"] as const) {
      expect(workflow).not.toContain(forbiddenToken);
    }
  });
});

describe(".github/workflows/mac-package.yml", () => {
  it("is a bounded manual unsigned macOS package gate with dynamic metadata", async () => {
    const workflow = await readRepositoryFile(".github/workflows/mac-package.yml");

    expect(workflow).toMatch(/^on:\r?\n  workflow_dispatch:\r?\n\r?\npermissions:/m);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("node scripts/release-metadata.mjs");
    expect(workflow).toContain("npm run package:mac");
    expect(workflow).toContain("steps.metadata.outputs.mac_artifact_name");
    expect(workflow).toContain("steps.metadata.outputs.mac_path");
    expect(workflow).toContain("if-no-files-found: error");
    for (const forbiddenToken of ["GH_TOKEN", "secrets.", "gh release", "contents: write"] as const) {
      expect(workflow).not.toContain(forbiddenToken);
    }
  });
});

describe(".github/workflows/release.yml", () => {
  it("keeps the release draft until both platform assets pass", async () => {
    // Given: the tag-triggered release workflow
    const release = await readRepositoryFile(".github/workflows/release.yml");
    const [windowsJob, macJob] = release.split(/\n  release-mac:/, 2);

    // When: trigger, permissions, runner, and gates are inspected
    // Then: only a version tag push can publish, and only with write
    // permissions on the same smoke-gated pipeline as the manual workflow
    expect(release).toMatch(/^on:\r?\n  push:\r?\n    tags: \['v\*'\]/m);
    expect(release).toContain("contents: write");
    expect(release).toContain("Derive and verify release metadata");
    expect(release).toContain("node scripts/release-metadata.mjs");
    expect(release).toContain("RELEASE_TAG");
    expect(release).toContain("runs-on: windows-latest");
    expect(release).toContain("timeout-minutes: 45");
    for (const command of ["npm ci", "npm test", "npm run typecheck", "npm run package:win"] as const) {
      expect(release).toContain(command);
    }
    expect(release).toContain("Assert-PackagedRuntimeClosure");
    expect(release).toContain('Assert-PackagedRuntimeClosure -Label "win-unpacked"');
    expect(release).toContain('Assert-PackagedRuntimeClosure -Label "installed"');
    expect(release).toContain("Assert-VendoredProfileSeed");
    expect(release).toContain("resources/profile-web/payload");
    expect(release).toContain('Assert-VendoredProfileSeed -Label "win-unpacked"');
    expect(release).toContain('Assert-VendoredProfileSeed -Label "installed"');
    expect(release).toContain("Assert-VendoredPnpm");
    expect(release).toContain("resources/app/node_modules/pnpm/bin/pnpm.cjs");
    expect(release).toContain('Assert-VendoredPnpm -Label "win-unpacked"');
    expect(release).toContain('Assert-VendoredPnpm -Label "installed"');
    expect(release).toContain("::notice::vendored pnpm 11.8.0 present in packaged tree.");

    // Then: the prerelease publish attaches the exact setup executable
    const generatedNotesFlag = ["--generate", "notes"].join("-");
    expect(windowsJob).toContain("Create or update draft GitHub release");
    expect(windowsJob).toContain("--draft");
    expect(windowsJob).toContain("--verify-tag");
    expect(windowsJob).toContain("--notes-file");
    expect(windowsJob).not.toContain(generatedNotesFlag);
    expect(windowsJob).toContain("already public");
    expect(windowsJob).toContain("steps.metadata.outputs.windows_path");
    expect(windowsJob).not.toContain("--draft=false");
    expect(windowsJob).not.toContain("dist/dsh-flightdeck-");
    expect(release).toContain("release_notes_path");
    expect(release).toContain("Prepare release notes (default Full Changelog)");
    expect(release).toContain("node scripts/prepare-release-notes.mjs");
    expect(release).toContain("fetch-depth: 0");
    expect(release).toContain("GITHUB_REPOSITORY: ${{ github.repository }}");
    expect(release).toContain("Verify release notes before build");
    const releaseNotesScript = await readRepositoryFile("scripts/prepare-release-notes.mjs");
    expect(releaseNotesScript).toContain("docs/releases/<tag>.md is absent");
    expect(releaseNotesScript).toContain("findPreviousVersionTag");
    expect(releaseNotesScript).toContain("**Full Changelog**");
    expect(releaseNotesScript).toContain("/compare/");
    expect(release).toContain("--notes-file");
    expect(release).not.toContain(generatedNotesFlag);
    expect(release).toContain("GH_TOKEN: ${{ github.token }}");
    expect(release).toContain("dsh-flightdeck-windows-diagnostics");
    expect(macJob).toContain("needs: release");
    expect(macJob).toContain("node scripts/release-metadata.mjs");
    expect(macJob).toContain("npm run package:mac");
    expect(macJob).toContain("steps.metadata.outputs.mac_path");
    expect(macJob).toContain("Upload macOS dmg to draft release");
    expect(macJob).toContain("gh release upload");
    expect(macJob).toContain("Verify release assets and publish");
    expect(macJob).toContain("WINDOWS_FILENAME");
    expect(macJob).toContain("MAC_FILENAME");
    expect(macJob).toContain("grep -Fqx");
    expect(macJob).toContain("--draft=false");
    expect(macJob).toContain("--prerelease=true");
    expect(macJob).toContain("--prerelease=false");
    expect(macJob).toContain("--latest");
    expect(macJob).toContain("--latest=false");
    expect(macJob).toContain("dsh-flightdeck-macos-diagnostics");
  });
});

describe("src navigation security contracts", () => {
  it("bans ts-pattern .run() in every source file", async () => {
    // Given: every TypeScript source file under src/
    const entries = await readdir(join(REPOSITORY_ROOT, "src"), { recursive: true });
    const sources = entries.filter((entry) => entry.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);

    // When: each source is read
    // Then: no source calls the unflagged .run() match branch
    for (const relative of sources) {
      expect(await readRepositoryFile(join("src", relative))).not.toContain(".run(");
    }
  });

  it("routes redirects through the same webview-guarded navigation seam", async () => {
    // Given: the main-process navigation seam
    const security = await readRepositoryFile("src/main/security.ts");

    // Then: server redirects and webview attachment are both governed
    expect(security).toContain("will-redirect");
    expect(security).toContain("will-attach-webview");
  });

  it("disables webviewTag in the main window options", async () => {
    // Given: the main window creation options
    const index = await readRepositoryFile("src/main/index.ts");

    // Then: no webview embedding is possible in the primary window
    expect(index).toContain("webviewTag: false");
  });

  it("overrides the Electron userData directory through an explicit environment variable", async () => {
    // Given: the main-process entry
    const index = await readRepositoryFile("src/main/index.ts");

    // Then: the override is applied before readiness so the smoke can isolate DSH_HOME per phase
    expect(index).toContain("DSH_FLIGHTDECK_USER_DATA");
    expect(index).toContain('app.setPath("userData", userDataOverride)');
  });
});
