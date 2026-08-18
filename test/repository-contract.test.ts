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
  it("declares the exact v0.0.1 package identity", async () => {
    // Given: the repository package.json
    // When: parsed into a typed shape
    const pkg = parsePackageJson(await readRepositoryFile("package.json"));

    // Then: identity matches the initialization plan review decisions
    expect(pkg.name).toBe("dsh-flightdeck");
    expect(pkg.version).toBe("0.0.1");
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

    // When: the three pinned runtime inputs are read
    // Then: each resolves to its exact section 5.1 version
    expect(requiredString(pkg.dependencies, "@deepseek-ai/dsh")).toBe("0.1.0-rc.7");
    expect(requiredString(pkg.dependencies, "node")).toBe("24.19.0");
    expect(requiredString(pkg.dependencies, "ts-pattern")).toBe("5.9.0");
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
    expect(requiredString(scripts, "package:dir")).toContain("--publish never");
    expect(requiredString(scripts, "package:win")).toContain("verify:target:win");
    expect(requiredString(scripts, "package:win")).toContain("--publish never");
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
    expect(readBoolean(build, "npmRebuild")).toBe(false);
    expect(readString(build, "compression")).toBe("maximum");
    expect(readStringArray(build, "files")).toEqual(["out/**/*", "node_modules/**/*", "package.json", "!**/*.map"]);
    expect(extraResources).toEqual([
      { from: "build/splash.html", to: "splash.html" },
      { from: "build/runtime-node-entry.mjs", to: "runtime-node-entry.mjs" },
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
      artifactName: "dsh-flightdeck-windows-${arch}-setup.${ext}",
    });
    for (const forbiddenKey of ["publish", "mac", "linux", "electronUpdaterCompatibility"] as const) {
      expect(build[forbiddenKey]).toBeUndefined();
    }
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
    expect(lockEntryVersion(lock, "")).toBe("0.0.1");
  });

  it("locks the exact pinned runtime inputs", async () => {
    // Given: the parsed lockfile
    const lock = parsePackageLock(await readRepositoryFile("package-lock.json"));

    // When: the two runtime entries are read
    // Then: they resolve to the exact section 5.1 versions
    expect(lockEntryVersion(lock, "node_modules/@deepseek-ai/dsh")).toBe("0.1.0-rc.7");
    expect(lockEntryVersion(lock, "node_modules/node")).toBe("24.19.0");
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
    expect(workflow).toContain("actions/checkout@v4");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("cache: npm");
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
  });

  it("uploads one setup with strict absence handling and no distribution authority", async () => {
    // Given: the Windows package workflow artifact steps
    const workflow = await readRepositoryFile(".github/workflows/windows-package.yml");

    // When: upload and authority tokens are inspected
    // Then: the setup is mandatory, diagnostics are failure-only, and distribution remains impossible
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("dist/dsh-flightdeck-windows-x64-setup.exe");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain("if: failure()");
    expect(workflow).toContain("if-no-files-found: warn");
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow).not.toContain("tags:");
    for (const forbiddenToken of ["GH_TOKEN", "secrets.", "release", "publish", "signing"] as const) {
      expect(workflow).not.toContain(forbiddenToken);
    }
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
