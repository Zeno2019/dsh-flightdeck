# Architecture

This document describes the implemented architecture of DSH Flightdeck. It is descriptive only. The authoritative sources are listed at the end.

## Process boundary

The application has one Electron process, the main process (`src/main/index.ts`). There is no custom renderer source, no preload script, and no IPC. The only local page is the static splash page (`build/splash.html` in development, `resources/splash.html` packaged). The DSH Web UI is served by a separate child process and loaded into the BrowserWindow at its loopback origin.

The main process spawns a dedicated Node binary, never the Electron executable. Electron and ordinary Node can expose different native-module ABIs, so DSH native dependencies stay on the ordinary Node ABI. The child command is:

```text
<bundled node> --expose-internals <runtime entry> <dsh bin> web --host 127.0.0.1 --port <reserved port>
```

- Bundled node: `node_modules/node/bin/node` (or `node.exe` on Windows).
- Runtime entry: `build/runtime-node-entry.mjs` in development, the `resources` copy after packaging.
- DSH bin: `node_modules/@deepseek-ai/dsh/lib/bin.js`.
- The runtime entry logs `[desktop-runtime]` diagnostics and marks the process fatal on `uncaughtException` or `unhandledRejection`, writing the failure reason synchronously to stderr so it survives `process.exit`.

## Reserved port flow

The port is reserved, never parsed from child output:

1. `reserveLoopbackPort()` binds a temporary IPv4 socket to `127.0.0.1:0` and reads the OS-assigned concrete port.
2. The temporary socket is closed.
3. The concrete port is passed to DSH with `--port`.
4. `waitUntilReady()` polls HTTP GET at `http://127.0.0.1:<port>` until a 2xx response arrives or the startup timeout expires.
5. Only then does the window navigate from the splash page to the DSH origin.

The harness emits `[desktop] endpoint http://127.0.0.1:<port>` for logging and for the packaged smoke gate.

## Runtime paths

`src/main/runtime-paths.ts` resolves paths per mode and platform. Win32 uses win32 path semantics and `node.exe`; every other platform uses POSIX semantics and the bare `node` binary.

Development (`appRoot` is the repository root):

| Path | Value |
| --- | --- |
| nodeExecutable | `<root>/node_modules/node/bin/node` |
| dshBin | `<root>/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| assetsDir | `<root>/build` |
| runtimeEntry | `<root>/build/runtime-node-entry.mjs` |

Packaged (`appRoot` is the installed `resources/app`):

| Path | Value |
| --- | --- |
| nodeExecutable | `<resources>/app/node_modules/node/bin/node.exe` |
| dshBin | `<resources>/app/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| assetsDir | `<resources>` |
| runtimeEntry | `<resources>/runtime-node-entry.mjs` |

The packaged assets come from `extraResources` in the electron-builder config.

## Security policy

Every BrowserWindow starts with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and `webviewTag: false`.

The navigation policy is exact-origin (`src/main/security-policy.ts`):

- Only the exact current `http://127.0.0.1:<port>` origin and the exact splash file URL are allowed in-app.
- External HTTP and HTTPS links open through the system shell.
- All other protocols and malformed URLs are denied.
- `will-attach-webview` is prevented.
- `window.open` is denied for new windows; trusted URLs load in the same window.
- Permissions: only `clipboard-sanitized-write` from the harness origin in the main frame is granted. Everything else is denied through both the permission check and request handlers.
- Aborted navigation errors (`ERR_ABORTED`, `errno -3`) are ignored.

## User data layout

All runtime state lives under the Electron user data directory (`app.getPath("userData")`):

| Path | Purpose |
| --- | --- |
| `<userData>/launch` | Child process working directory |
| `<userData>/harness` | `DSH_HOME` for the DSH child |
| `<userData>/logs/harness.log` | Append-mode log for child stdout, stderr, and harness lines |
| `<userData>/tools` | Windows-only `pnpm.cmd` launcher, rewritten on every startup |

Before the app is ready, a non-empty `DSH_FLIGHTDECK_USER_DATA` environment variable overrides that directory (`app.setPath("userData", ...)`). The packaged smoke sets one per phase, so the unpacked and installed executions can never share `DSH_HOME`, logs, or junctions. It also serves portable installations.

The child is spawned with `windowsHide: true`, piped stdio, `NO_COLOR=1`, and `ELECTRON_RUN_AS_NODE` removed from the environment. Output is written to the log file and a bounded ring of the most recent 200 lines.

## Vendored dependency repair

`@deepseek-ai` packages are repaired by patches under `patches/`, replayed by `postinstall` on every clean install.

## Packaged runtime closure

The DSH peer-only closure (19 packages) is declared as direct dependencies in `package.json` so it ships in the packaged artifact.

## Vendored web profile seeding

The profile seed ships via `extraResources`, seeds on first launch only, and never overwrites a user-edited profile; runtime needs no pnpm or network.

## Vendored tool launchers (pnpm + dsh)

Packaged installs rely on vendored-node `pnpm`/`dsh` launchers for plugin installs, so target machines need no Node toolchain.

## Startup and shutdown

Startup:

- A single-instance lock is requested; a second instance focuses the existing window.
- The application menu is removed.
- The splash page loads and shows immediately.
- `HarnessRuntime.start()` creates the directories, reserves the port, spawns the child, and polls readiness.
- On readiness the window loads the DSH origin and shows.
- On startup timeout, spawn failure, or an unexpected child exit, an error dialog is shown and the app quits.

Shutdown:

- `before-quit` is intercepted. The shell phase becomes `quitting`, `runtime.stop()` runs, and only then is quit allowed.
- `stop()` sends `SIGTERM` and waits up to the stop grace period. If the child has not exited, it is force-killed: `taskkill /PID <pid> /T /F` on Windows, `SIGKILL` elsewhere.
- A deliberate stop is recorded separately from a crash, so an expected exit never triggers the failure dialog.
- `window-all-closed` quits the app.

Lifecycle constants live in `src/shared/contracts.ts`:

| Constant | Value |
| --- | --- |
| Windows startup timeout | 120 s |
| Default startup timeout | 45 s |
| Readiness poll interval | 250 ms |
| HTTP request timeout | 1 s |
| Stop grace period | 4 s |
| Progress log interval | 10 s |
| Maximum retained log lines | 200 |

Runtime phases: `idle`, `starting`, `ready`, `stopping`, `stopped`, `failed`. Outcomes: `ready`, `exited` (with a deliberate flag), `startup-timeout`, `spawn-failed`.

## Process tree

```text
Electron main process
`-- bundled Node (runtime-node-entry.mjs)
    `-- DSH CLI (lib/bin.js) serving the Web UI on 127.0.0.1:<port>
```

On Windows, forced shutdown uses `taskkill /T`, which terminates child processes of the DSH Node process as well. On non-Windows development hosts, forced shutdown sends `SIGKILL` to the direct bundled Node child.

## ts-pattern policy

ts-pattern is pinned for readability, not exhaustiveness for its own sake:

- Use `match` for multi-branch, nested structural, or discriminated-union logic where it reduces cognitive load over native conditionals.
- Use `.exhaustive()` for closed unions so the compiler proves every case is handled.
- Use `.otherwise()` only for intentional open or default semantics.
- `.run()` is forbidden; prefer the direct value-returning form.
- Simple guards, null checks, and one-or-two-branch conditions stay native.
- No mechanical conversion of working code.

## Source of truth

| Concern | Source of truth |
| --- | --- |
| Identity and exact versions | `package.json` and `package-lock.json` |
| Lifecycle constants | `src/shared/contracts.ts` |
| Security policy | `src/main/security-policy.ts` |
| Windows smoke procedure | `.github/workflows/windows-package.yml` |
| Release procedure | `.github/workflows/release.yml` |
| Documentation | descriptive only, never authoritative |
