# Testing

This document describes the test and verification responsibilities of DSH Flightdeck. It is descriptive only.

## Unit tests

The suite runs with Vitest and covers pure logic without launching Electron: **129 tests across 8 files**.

`test/runtime.test.ts` covers the runtime boundary:

- The exact lifecycle constants in `src/shared/contracts.ts`.
- Runtime path resolution for development and packaged modes, including the `runtime-node-entry.mjs` location in each mode.
- The DSH harness arguments (`web --host 127.0.0.1 --port <port>`).
- The full Node argument list (`--expose-internals`, runtime entry, DSH bin, harness args).
- Spawn options: a fresh environment copy that keeps `Path`, sets `NO_COLOR` and `DSH_HOME`, and drops `ELECTRON_RUN_AS_NODE`.
- Exit-code formatting and 2xx readiness classification.
- Loopback port reservation against a real server.
- Readiness polling, including abort behavior.
- `HarnessRuntime` stop idempotence and the child-exit race.

`test/security-policy.test.ts` covers the exact-origin policy:

- Only the exact harness origin and the exact splash file URL are trusted in-app.
- Host aliases, other ports, https loopback, external URLs, and non-http schemes are rejected.
- External HTTP(S) navigation is classified as open-external with the URL preserved.
- Top-level navigation and server redirects share the same exact-origin routing seam.
- Unsupported and malformed navigation is denied.
- Only `clipboard-sanitized-write` from the harness origin in the main frame is granted.
- Aborted navigation errors are recognized.

`test/repository-contract.test.ts` reads repository files through `test/repository-reader.ts` and asserts the contract:

- Package identity and the exact pins in `package.json` and `package-lock.json`.
- No `electron-updater` dependency.
- The script contract, with both packaging commands running `verify:target:win` and `--publish never`.
- The electron-builder contract: `asar: false`, `npmRebuild: false`, `extraResources`, NSIS x64 only, and no `publish`, `mac`, or `linux` keys.
- The patch-package seam: `postinstall` is `patch-package` and the pinned `@deepseek-ai/dsh-app-boot` patch contains the Windows junction repair.
- `ci.yml` runs the fast gate on `windows-latest` with read-only permissions and no packaging.
- `windows-package.yml` is a manual `workflow_dispatch` gate with the smoke seams: log endpoint discovery, HTTP polling, fatal markers, graceful close, baseline Node PID ownership, silent install, and per-phase isolated user-data directories.
- The main process applies the `DSH_FLIGHTDECK_USER_DATA` user-data override before readiness.

`test/profile-fallback.test.ts` exercises the repaired third-party profile fallback directly:

- A first heal creates the flat `$DSH_HOME/profiles/node_modules` link.
- A second, identical heal is a no-op — this is the exact junction case that crashed before the patch.
- A heal from a moved installation re-points the existing link.
- A real directory in a managed slot still fails loud instead of being deleted.

On `windows-latest` CI these tests create and re-point real NTFS junctions, so the Windows-only branch of the repair is exercised by `npm test` in both workflows.

`test/runtime-entry.test.ts` spawns `build/runtime-node-entry.mjs` against failing fixture bins and asserts the fatal marker reaches stderr synchronously with the actual error reason before exit code 1.

`test/profile-seed.test.ts` covers the vendored web profile seed: a fresh DSH_HOME receives the complete staged profile, an existing profile is never overwritten, and a missing staged source rejects so the caller can degrade to DSH's template initialization.

`test/tool-launchers.test.ts` covers the vendored `pnpm` and `dsh` launcher contracts: exact entry-point resolution, executable launcher content, and the non-Windows no-op boundary.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Vitest suite once |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run build` | Compile the main-process output with electron-vite |

## Target-gated packaging and local limitations

Packaging is target-gated by `scripts/verify-target.mjs`:

- Windows commands (`package:dir`, `package:win`) require Windows x64.
- macOS commands (`package:mac:dir`, `package:mac`) require macOS arm64 (Apple Silicon).

On this macOS development machine the Windows commands fail fast and the Windows smoke procedure cannot run locally. A macOS package run is only meaningful on the required arm64 target; neither local platform substitutes for the other platform's release gate.

## CI

`.github/workflows/ci.yml` runs on pushes to `master` and on pull requests. It uses `windows-latest` with read-only repository permissions and runs `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. On a normal Windows runner the test gate is expected to be **129/129**; it does not package, publish, sign, or upload release assets. The macOS package and release jobs run the same 129-test gate on a normal macOS runner before their target-gated packaging smoke.

## Manual Windows packaging smoke

`.github/workflows/windows-package.yml` runs only through `workflow_dispatch` on `windows-latest` with a 45-minute timeout and read-only permissions. It is the end-to-end gate that unit tests cannot provide.

Steps:

1. `npm ci` (the postinstall script reapplies the pinned dependency patch), `npm test`, `npm run typecheck`.
2. `npm run package:win` to stage the vendored web profile, then build the unpacked app and the NSIS installer.
3. Smoke the unpacked app at `dist/win-unpacked/DSH Flightdeck.exe` with an isolated user-data directory.
4. Record that the current smoke is the reduced HTTP 2xx gate and does not exercise a keyless DSH RPC.
5. Silently install the setup into a temporary directory with `/S /D=`.
6. Smoke the installed app at the temporary install directory with its own isolated user-data directory.
7. Upload the unsigned installer artifact and, on failure, diagnostics.

Smoke responsibilities, per executable form:

- Record baseline Node PIDs before launch.
- Point `DSH_FLIGHTDECK_USER_DATA` at a per-phase temporary directory (`dsh-flightdeck-smoke-win-unpacked` / `dsh-flightdeck-smoke-installed`) and restore the previous value afterwards, so the phases never share `DSH_HOME`.
- Discover the DSH endpoint from the harness log line `[desktop] endpoint http://127.0.0.1:<port>` in `<user-data>\logs\harness.log`.
- Poll HTTP 2xx at that exact origin within 180 seconds.
- Fail if the log contains a fatal marker, including spaced or camelCase `uncaughtException` and `unhandledRejection` forms.
- Close gracefully with `CloseMainWindow`, falling back to `taskkill /T /F`.
- Verify no new `node.exe` PIDs remain beyond the baseline; kill and fail if any do.
- Copy the harness log to the diagnostics directory.

The workflow requires exactly one setup executable, uploads it with `if-no-files-found: error`, and uploads failure diagnostics with `if-no-files-found: warn`. For v0.1.1 the expected installer is `dsh-flightdeck-0.1.1-dsh-0.1.0-rc.7-windows-x64-setup.exe`. It creates no GitHub Release.

## Release contracts

`scripts/release-metadata.mjs` derives the Flightdeck version, bundled DSH version, exact Windows and macOS asset names, prerelease state, and `release_notes_path=docs/releases/${expectedTag}.md` from the package metadata. The release workflow verifies that notes file before building. The Windows job creates or updates a Draft with `--notes-file` and uploads the NSIS asset; it does not use generated notes. The macOS job builds the target-gated arm64 DMG, uploads it to the same Draft, verifies both exact assets, and only then publishes. Release packages remain unsigned; the final release notes carry the SmartScreen/Gatekeeper and limited-validation disclosures.

## Verified locally vs pending

Verified in this local macOS session:

- `npm test` reports **125 passed, 4 failed** out of 129 and exits non-zero in this restricted sandbox. All four failures are the permitted loopback-bind error `Error: listen EPERM: operation not permitted 127.0.0.1`; no other failure is accepted. The normal Windows/macOS runner release gate remains **129/129**.
- Typecheck clean (`npm run typecheck`).
- electron-vite build successful (`npm run build`), with the expected warning that only the main process is configured.
- `scripts/prepare-profile-web.mjs` stages `dshmarket@1.14.1` and `dsh-find-plugin@0.3.7` into `build/profile-web/payload`: symlink-free npm production tree, zero `@deepseek-ai` duplication, idempotent reruns. The payload nests below the copy root because electron-builder drops a root-level `node_modules` of an extraResources source directory. Plugin peers (`@deepseek-ai/cordis@4.0.1`, `@deepseek-ai/dsh-settings@0.1.0-rc.7`, `@deepseek-ai/dsh-tools@0.1.0-rc.7`) resolve against the repository closure.
- The vendored pnpm probe path: the bundled `node_modules/node/bin/node` runs the pinned `node_modules/pnpm/bin/pnpm.cjs` and prints `11.8.0`; a simulated dshmarket probe with the tooling stripped from PATH fails corepack/npm/pnpm (ENOENT, the 0.1.0-rc.2 real-machine symptom), and the same probe with a generated launcher directory on PATH resolves `pnpm --version` to `11.8.0` (exit 0) — the exact success gate dshmarket's `provisionPnpm` checks.
- The vendored dsh launcher path: the bundled `node_modules/node/bin/node` runs `@deepseek-ai/dsh/lib/bin.js --version` and prints `0.1.0-rc.7` (exit 0) — the exact command line `dsh.cmd` forwards on the real machine, answering dshmarket's bare-`dsh` re-invocation (`dshArgv` falls back to PATH because the harness entry does not match its `bin.js`-shaped argv[1] check).
- A clean `npm ci` reapplies the pinned `@deepseek-ai/dsh-app-boot` patch through the `postinstall` script.
- Desktop splash captures at `1280x800` and `800x600`, reviewed through `agent-vision-mcp` and two independent read-only passes with no blockers.

Verified on CI and a real Windows machine (2026-08-19):

- The `workflow_dispatch` Windows package run passed: both runtime closure notices reported 195 `@deepseek-ai` packages and both smokes reached HTTP 2xx; the `dsh-flightdeck-windows-x64-nsis` artifact was uploaded.
- Real machine: wizard install, launch with the DSH UI loading, second launch is a single instance (no multi-instance), clean uninstall, and the bundled `@vscode/ripgrep-win32-x64@1.18.0` binary is present for file search.
- Manual acceptance of the published RC.9 assets (2026-08-21): the RC.8 → RC.9 upgrade flow passed — profile/session/settings preservation, real prompt and tool use, marketplace installation, restart, and uninstall/reinstall behavior. v0.1.0 promotes the RC.9 build to stable with no functional changes; v0.1.1 adds the runtime-derived DSH/splash version fix.

Pending, not yet executed or proven:

- The vendored web profile seed on a packaged Windows build: the staging script is verified locally, but the first-launch seed has not yet run through a Windows smoke. The next `workflow_dispatch` run on this revision is the gate.

## Manual vendored-profile checks

On a real Windows machine, after installing this revision:

- The installer carries the seed under `%LOCALAPPDATA%\Programs\DSH Flightdeck\resources\profile-web\payload` (manifest, `cordis.patch.yml`, and the five-package `node_modules` tree).
- After first launch, `%APPDATA%\DSH Flightdeck\harness\profiles\web` exists with the `dsh.profile.bundles` list, `pnpm-workspace.yaml` (containing `autoInstallPeers: false`), and `node_modules\dshmarket`; the marketplace and the find plugin are usable in the DSH UI.
- After first launch, `%APPDATA%\DSH Flightdeck\tools\pnpm.cmd` and `tools\dsh.cmd` exist on machines without any Node tooling — they run the vendored `node.exe` against the packaged `pnpm.cjs` and `@deepseek-ai\dsh\lib\bin.js`, so the market's one-click pnpm setup short-circuits through its `pnpm --version` probe and plugin installs re-invoke the DSH CLI through `dsh.cmd` (dshmarket's `dshArgv` only recognizes `bin.js`-shaped argv[1], which the harness entry is not). Smoke: `cmd /c "%APPDATA%\DSH Flightdeck\tools\dsh.cmd" --version` prints the DSH version (install nothing).
- Installing a plugin from the market UI succeeds on a machine with no node/npm/corepack/pnpm on PATH (this migrates the seeded npm-flat tree to pnpm's layout on first use — expected, and installs need network anyway).
- A second launch never overwrites an existing or user-edited profile.
