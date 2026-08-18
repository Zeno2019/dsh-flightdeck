# Testing

This document describes the test and verification responsibilities of DSH Flightdeck. It is descriptive only.

## Unit tests

The suite runs with Vitest and covers pure logic without launching Electron. 89 tests pass locally.

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
- `ci.yml` runs the fast gate on `windows-latest` with read-only permissions and no packaging.
- `windows-package.yml` is a manual `workflow_dispatch` gate with the smoke seams: log endpoint discovery, HTTP polling, fatal markers, graceful close, baseline Node PID ownership, and silent install.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Vitest suite once |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run build` | Compile the main-process output with electron-vite |

## Local macOS limitations

The packaging commands are Windows-x64-only. `scripts/verify-target.mjs` fails fast on any other platform or architecture, so `package:dir` and `package:win` cannot run on this macOS machine. The Windows smoke procedure cannot run locally either.

## CI

`.github/workflows/ci.yml` runs on pushes to `master` and on pull requests. It uses `windows-latest` with read-only repository permissions and runs `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. It does not package, publish, sign, or upload release assets.

## Manual Windows packaging smoke

`.github/workflows/windows-package.yml` runs only through `workflow_dispatch` on `windows-latest` with a 45-minute timeout and read-only permissions. It is the end-to-end gate that unit tests cannot provide.

Steps:

1. `npm ci`, `npm test`, `npm run typecheck`.
2. `npm run package:win` to build the unpacked app and the NSIS installer.
3. Smoke the unpacked app at `dist/win-unpacked/DSH Flightdeck.exe`.
4. Record that the current smoke is the reduced HTTP 2xx gate and does not exercise a keyless DSH RPC.
5. Silently install the setup into a temporary directory with `/S /D=`.
6. Smoke the installed app at the temporary install directory.
7. Upload the unsigned installer artifact and, on failure, diagnostics.

Smoke responsibilities, per executable form:

- Record baseline Node PIDs before launch.
- Discover the DSH endpoint from the harness log line `[desktop] endpoint http://127.0.0.1:<port>` in `%APPDATA%\DSH Flightdeck\logs\harness.log`.
- Poll HTTP 2xx at that exact origin within 180 seconds.
- Fail if the log contains a fatal marker, including spaced or camelCase `uncaughtException` and `unhandledRejection` forms.
- Close gracefully with `CloseMainWindow`, falling back to `taskkill /T /F`.
- Verify no new `node.exe` PIDs remain beyond the baseline; kill and fail if any do.
- Copy the harness log to the diagnostics directory.

The workflow requires exactly one setup executable, uploads it with `if-no-files-found: error`, and uploads failure diagnostics with `if-no-files-found: warn`. It creates no GitHub Release.

## Verified locally vs pending

Verified in this local macOS session:

- 89 tests passing (`npm test`).
- Typecheck clean (`npm run typecheck`).
- electron-vite build successful (`npm run build`), with the expected warning that only the main process is configured.
- Desktop splash captures at `1280x800` and `800x600`, reviewed through `agent-vision-mcp` and two independent read-only passes with no blockers.

Pending, not yet executed or proven:

- The `workflow_dispatch` Windows package and smoke run. It exists in the repository but has not been run in this session.
