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

`@deepseek-ai/dsh@0.1.0-rc.7` maintains `$DSH_HOME/profiles/node_modules` with NTFS directory junctions on Windows. Its `ensureSymlink` decided link ownership with `lstatSync(...).isSymbolicLink()` and removed links with `unlinkSync`, but junctions are reported as directories (not symlinks) and cannot be unlinked — so re-pointing the fallback after an installation move crashed the child with `uncaughtException`.

`patches/@deepseek-ai+dsh-app-boot+0.1.0-rc.7.patch` repairs `ensureSymlink`: junctions are recognized via `readlinkSync`, compared with NT-prefix tolerance, and removed with `rmdirSync` (which deletes the reparse point, never the target). The `postinstall` script (`patch-package`) reapplies the patch on every clean install, and `test/profile-fallback.test.ts` exercises create/idempotent-heal/re-point/real-directory rejection on the CI platform.

## Packaged runtime closure

electron-builder's production dependency collector walks only `dependencies` edges, so packages reachable solely through DSH `peerDependencies` (npm lock entries marked `"peer": true`) are silently dropped from `resources/app/node_modules`. The unpacked smoke used to mask this gap: Node's parent-directory walk from `dist/win-unpacked` escapes into the repository's own `node_modules`; an installed copy in an unrelated directory cannot, and DSH dies with `ERR_MODULE_NOT_FOUND` while loading `@deepseek-ai/dsh-app-boot`.

The full peer-only closure of `@deepseek-ai/dsh@0.1.0-rc.7` (19 packages) is declared as direct dependencies in `package.json`, and `windows-package.yml` verifies before every smoke that each repository `node_modules/@deepseek-ai` package exists in both the `win-unpacked` and the installed trees — a future DSH upgrade that changes the peer closure fails the packaging step loudly instead of surfacing as an opaque fatal marker.

## Vendored web profile seeding

DSH initializes a missing `web` profile from a template with empty dependencies, and `dsh plugin` is the only supported installer (pnpm + network on the target machine). The desktop app ships a prepared profile instead:

- `scripts/prepare-profile-web.mjs` stages `build/profile-web/payload` at packaging time: the profile manifest (template bundles `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` plus the four approved plugins), an empty `cordis.patch.yml`, the DSH profile's own `pnpm-workspace.yaml` (byte-identical to dsh-app-boot's `PROFILE_PNPM_WORKSPACE` template), and a symlink-free npm production tree for `dshmarket@1.14.1`, `dsh-find-plugin@0.3.7`, `dsh-anchored-subagent@0.3.0`, and `dsh-better-sidebar@0.13.1`. `dsh-anchored-subagent` is GitHub-only: the seed pins a codeload tarball URL at an exact commit so npm resolves it at packaging time and the target machine never needs git (the `github:` form would make pnpm re-resolve through git on the heal path). `dsh-better-sidebar`'s `node-pty` ships N-API prebuilds for darwin/win32 x64+arm64, so installs never trigger native compilation; the packaging workflows pin setup-node to `24.19.0` (the vendored runtime's version) so any fallback compile could never skew the ABI. All 15 `@deepseek-ai` peers of `dsh-better-sidebar` resolve from the packaged closure (`@deepseek-ai/cordis@4.0.1` included); its bare `cordis` peer is type-level only (erased `.d.ts` import). Plugin peer dependencies are deliberately not vendored — they resolve at runtime from the packaged DSH closure healed into `$DSH_HOME/profiles/node_modules`.
- The `pnpm-workspace.yaml` is load-bearing, not cosmetic: its `autoInstallPeers: false` stops pnpm's default peer auto-install, which otherwise walks the seeded plugins' `@deepseek-ai` peer ranges into restricted (private) registry packages and makes every market install fail with an unresolvable dependency — the `0.1.0-rc.4` real-machine failure (`@deepseek-ai/dsh-type-meta`). `dsh-find-plugin` is pinned to `0.3.7` because `0.3.6`'s peer range `@deepseek-ai/dsh-tools@^0.0.1-rc.1` resolves only to restricted `0.0.1-rc.x` versions; `0.3.7` moved the peer to the public `^0.1.0-rc.6` line.
- The payload nests one level below the extraResources copy root because electron-builder drops a `node_modules` directory sitting at the root of a copied directory (the `0.1.0-rc.1` CI run failed exactly this way: the manifest was seeded but the plugin tree was absent, and DSH fataled on the unresolvable `dshmarket` bundle). `windows-package.yml` and `release.yml` both assert the packaged `resources/profile-web/payload` tree before any smoke.
- electron-builder ships the staged tree as `resources/profile-web` through `extraResources`; the main process seeds from `resources/profile-web/payload`.
- On first launch only (packaged mode), `src/main/profile-seed.ts` copies the seed into `<userData>/harness/profiles/web`, keyed on the target `package.json` so an existing or user-edited profile is never overwritten.
- A seed failure degrades to DSH's empty-template initialization instead of blocking startup.
- Runtime needs no pnpm and no network. Plugin versions are frozen in the prepare script; changing them requires a rebuild.
- Installing further plugins from the market UI is covered by the vendored pnpm launcher below, so the target machine still needs no Node tooling. The first such install migrates the seed's npm-flat `node_modules` to pnpm's layout and re-resolves the two seeded plugins; installs require network anyway, so this is accepted.

## Vendored tool launchers (pnpm + dsh)

The DSH market probes the child PATH in two places, and the 0.1.0-rc.2 real machine already failed the first: the bundled runtime node ships no npm/corepack, and the host had no Node tooling on PATH. On win32 only, startup therefore writes two launchers under `<userData>/tools` (`src/main/tool-launchers.ts`), a directory the harness prepends to the child PATH:

- pnpm — the market provisions pnpm by probing PATH (`dshmarket@1.14.1` `dsh-cli.js`: `corepack enable`, then `npm install -g pnpm`, with `pnpm --version` as the success gate after each step — and its `spawnEnv` keeps the inherited PATH). `pnpm@11.7.0` is a direct `dependencies` pin (dependency-free JS package, engines node >=22.13, satisfied by the vendored `node@24.19.0`), so electron-builder's production collector ships it inside `resources/app/node_modules` like the rest of the closure. The version matches the `packageManager` field of the user-tested profile; `dataelement/dsh-desktop`'s 10.34.5 pin is the recorded alternative. The launcher runs `pnpm/bin/pnpm.cjs`.
- dsh — market plugin installs re-invoke the DSH CLI, but `dshArgv()` only recognizes `process.argv[1]` matching `/[\\/](?:bin\.(?:js|ts)|dsh)$/` (`dsh-cli.js:126-141`); the harness entry `runtime-node-entry.mjs` does not match, so the re-invocation falls back to a bare `dsh` on PATH — exactly the 0.1.0-rc.3 real-machine failure (`'dsh' is not recognized as an internal or external command`). The launcher runs the vendored DSH entry (`@deepseek-ai/dsh/lib/bin.js`, resolved by `runtime-paths` as `dshBin`) under the vendored node.
- Both launchers start with `@chcp 65001 >nul` — tool diagnostics would otherwise arrive as GBK garbage on Chinese Windows, the same garbled "not an internal or external command" text in the market logs — then the vendored `node.exe` resolved by `runtime-paths` running the vendored entry. They never use `process.execPath` (the Electron binary). Both files are rewritten on every startup, so an upgraded install cannot leave a stale absolute path.
- The harness child's PATH gets `<userData>/tools` prepended (`buildHarnessSpawnOptions` + `withPrependedPath` in `src/main/runtime.ts`; the Windows `Path`/`PATH` casing collision is merged into a single key). The injection flows parent → DSH → dshmarket → pnpm/dsh, because dshmarket's `spawnEnv` and the `dsh plugin` forwarder both inherit the child PATH.
- POSIX platforms get no launchers (the product packages Windows only; dev macOS machines carry their own tooling). A launcher write failure only logs and continues — no injection, never a blocked startup.

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
