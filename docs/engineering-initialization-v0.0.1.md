# DSH Flightdeck: Restrained Engineering Initialization Plan

- Document version: `0.0.1`
- Status: approved for implementation
- Repository visibility: private
- Target branch: `master`
- Initial platform: Windows x64

## 1. Purpose

DSH Flightdeck will be a standalone Electron repository that consumes an exact,
officially published DeepSeek Harness npm version. Electron owns the desktop
window, the child-process lifecycle, local readiness, logging, and Windows
packaging. It does not own the DSH package graph or rebuild the upstream
monorepo.

The first implementation milestone is deliberately narrow:

> Produce an unsigned Windows x64 NSIS installer that starts a pinned official
> DSH runtime on a clean machine without requiring a system Node.js, pnpm, or a
> first-run download.

This document is the approved engineering contract for that milestone. It is
not itself an application release.

## 2. Reference Hierarchy

### Primary reference

[`dataelement/dsh-desktop`](https://github.com/dataelement/dsh-desktop) at commit
[`86ef934d9e8252508d3a3b0d9b5dc071cd21086e`](https://github.com/dataelement/dsh-desktop/tree/86ef934d9e8252508d3a3b0d9b5dc071cd21086e)
is the primary engineering reference because it is an independent Electron
repository that consumes official DSH npm packages, bundles a dedicated Node
runtime, uses electron-builder, and exercises a packaged Windows application in
CI.

Patterns to retain:

- npm with a committed lockfile and `npm ci` in CI.
- TypeScript, strict type checking, electron-vite, and Vitest.
- A hardened BrowserWindow; the preload bridge is deliberately omitted for
  v0.0.1.
- An exact official DSH dependency and an exact bundled Node version.
- `--publish never` on non-release packaging commands.
- Native Windows packaging and a packaged-runtime smoke test.
- Contract tests that pin important package, workflow, and documentation rules.

Mature product features that are references only:

- Branding patches and replacement assets.
- Mobile pairing and LAN access.
- Market or plugin installation UI.
- Auto-update infrastructure and update mirrors.
- Signing, notarization, and multi-platform release matrices.
- Product-specific DSH patches.

### Pitfall reference

The existing `dsh-cockpit` project remains a failure-mode reference. Its useful
lessons are installation smoke testing, readiness timeouts, process cleanup,
runtime-link verification, and diagnostic logs. Its custom workspace tarball
assembler, bundled pnpm, offline profile seed, OCR assets, and plugin manager
must not be transferred into DSH Flightdeck.

## 3. Product and Architecture Decisions

### 3.1 Repository boundary

DSH Flightdeck remains an independent repository. It consumes an official npm
release and does not check out or build the DSH monorepo.

Consequences:

- DSH versions are updated deliberately through `package.json` and the lockfile.
- The desktop repository does not interpret `workspace:` dependencies.
- Upstream packaging defects are reported upstream rather than hidden in a
  second runtime assembler.
- A forked DSH runtime is out of scope until that fork provides an equivalent
  consumable npm release or a versioned runtime artifact.

### 3.2 Runtime ownership

The application bundles two pinned runtime inputs at build time:

1. An exact `@deepseek-ai/dsh` npm version.
2. An exact official Node.js x64 runtime version compatible with that DSH
   release.

The Electron executable must not be reused as the DSH Node executable. Electron
and ordinary Node can expose different native-module ABIs. A separate runtime
keeps DSH native dependencies on the ordinary Node ABI that upstream tests.

The application starts the equivalent of:

```text
<bundled node> --expose-internals <runtime-node-entry path> @deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port <reserved-port>
```

The `<runtime-node-entry path>` resolves per environment: the source
`build/runtime-node-entry.mjs` during development, and the packaged `resources`
copy (see the packaging contract in section 3.5) after installation. It is never
assumed to live under `<app>/build` in the installed layout.

The port is reserved, not parsed from output:

1. Bind a temporary IPv4 socket to `127.0.0.1:0` and read the OS-assigned
   concrete port.
2. Close the temporary socket.
3. Spawn the chain above with the concrete reserved port.
4. Poll HTTP GET at the exact origin `http://127.0.0.1:<port>` until a 2xx
   response arrives or the startup timeout expires.
5. Only then display the main window at that exact origin.

The harness emits the discovery line `[desktop] endpoint http://127.0.0.1:<port>`
for logging and for the packaged smoke gate.

### 3.3 Electron surface

The first application is a shell around the official DSH Web UI. There is no
custom renderer and no preload script. The only local page is the static
`build/splash.html`, shown until DSH readiness exists, after which the window
navigates to the DSH origin.

The main process owns:

- Stable application and user-data identity.
- DSH child-process start, readiness, failure reporting, and shutdown.
- A loopback-only BrowserWindow.
- Diagnostic logs under Electron user data.
- External-link handling and navigation restrictions.

Raw `ipcRenderer` is never exposed, and no preload bridge exists to expose
anything else.

### 3.4 Security defaults

Every BrowserWindow starts with:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
```

The navigation and window-open policy is exact-origin:

- Only the exact current `http://127.0.0.1:<port>` origin and the exact splash
  file URL are allowed in-app.
- External HTTP and HTTPS links open through the system shell.
- All other protocols are denied.
- Webviews and unrequested permissions are denied.
- Clipboard-sanitized-write is permitted only from the harness main frame.

### 3.5 Packaging posture

The first distributable target is Windows x64 NSIS only:

- Assisted installer (`oneClick: false`).
- Per-user installation.
- Installation directory may be changed.
- Unsigned, with the SmartScreen limitation documented.
- `--publish never`; CI uploads an artifact but creates no release.
- No portable ZIP, MSI, ARM64, macOS, or Linux target.

The electron-builder configuration is fixed by contract:

- `asar: false`; DSH and its native modules need an ordinary filesystem tree.
  ASAR optimization is reconsidered only after the installed runtime is stable.
- `npmRebuild: false`; native modules are already built for the exact pinned
  runtime.
- `compression: maximum`.
- Files include `out/**/*`, `node_modules/**/*`, `package.json`, and the
  configured exclude maps.
- `extraResources` contains `splash.html` and `runtime-node-entry.mjs`.
- Windows target is NSIS x64 only.
- There is no `publish` key.
- Both `package:dir` and `package:win` are Windows-x64-only, run
  `scripts/verify-target.mjs` first, and use `--publish never`.

## 4. Planned Repository Baseline

The implementation phase should converge on this tree. Files are introduced
only when their corresponding behavior exists; empty placeholder modules are
not created.

```text
dsh-flightdeck/
  .github/
    workflows/
      ci.yml
      windows-package.yml
  build/
    runtime-node-entry.mjs
    splash.html
  docs/
    architecture.md
    engineering-initialization-v0.0.1.md
    testing.md
  scripts/
    verify-target.mjs
  src/
    main/
      index.ts
      reserve-port.ts
      runtime.ts
      runtime-paths.ts
      security-policy.ts
      security.ts
    shared/
      contracts.ts
  test/
    repository-contract.test.ts
    runtime.test.ts
    security-policy.test.ts
  .gitignore
  electron.vite.config.ts
  package.json
  package-lock.json
  README.md
  tsconfig.json
  tsconfig.node.json
```

No renderer directory and no preload script are created while the official DSH
Web UI remains the only renderer.

## 5. Package and Tooling Baseline

### 5.1 Pinned versions

The implementation uses npm with a committed `package-lock.json`, a supported
Node.js development version declared in `engines`, electron-vite for
main-process compilation, TypeScript with `strict` and `noUncheckedIndexedAccess`,
and Vitest for Node-side tests. The following versions are pinned exactly:

```text
@deepseek-ai/dsh    0.1.0-rc.7
node                24.19.0
ts-pattern          5.9.0
electron            43.4.0
electron-builder    26.15.3
electron-vite       5.0.0
typescript          5.9.3
vitest              4.1.10
@types/node         24.10.1
```

The exact `node@24.19.0` npm dependency distributes the official platform Node
binary. `npm install` resolves the current host binary, so Windows packages are
built only after a clean `npm ci` on Windows x64.

npm and a committed `package-lock.json` fix the transitive graph.

### 5.2 Source of truth

Each concern has one authoritative location:

| Concern | Source of truth |
| --- | --- |
| Identity and exact versions | package.json and package-lock.json |
| Lifecycle constants | src/shared/contracts.ts |
| Security policy | src/main/security-policy.ts |
| Windows smoke procedure | .github/workflows/windows-package.yml |
| Documentation | descriptive only; never authoritative |

### 5.3 Lifecycle constants

`src/shared/contracts.ts` is the single home for timing values:

```text
Windows startup timeout      120 s
Default startup timeout       45 s
Readiness poll interval      250 ms
HTTP request timeout           1 s
Stop grace period              4 s
Progress log interval         10 s
Maximum retained log lines   200
```

### 5.4 Script contract

Required script contract:

```text
dev             start the development shell
build           compile production main-process output
typecheck       run tsc with no emit
test            run Vitest once
test:watch      run Vitest in watch mode
package:dir     build an unpacked Windows app with --publish never
package:win     build Windows x64 NSIS with --publish never
```

Both packaging scripts are Windows-x64-only, run `scripts/verify-target.mjs`
first, and pass `--publish never`.

No lint or formatting dependency is added until the project has enough source
to demonstrate a real need. TypeScript, tests, build checks, and review keep the
initial baseline smaller.

### 5.5 ts-pattern policy

ts-pattern is pinned for readability, not exhaustiveness for its own sake:

- Use `match` for multi-branch, nested structural, or discriminated-union logic
  where it reduces cognitive load over the equivalent native conditionals.
- Use `.exhaustive()` for closed unions so the compiler proves every case is
  handled.
- Use `.otherwise()` only for intentional open or default semantics.
- `.run()` is forbidden; prefer the direct value-returning form
  (`match(...).with(...).exhaustive()` or `... .otherwise(...)`).
- Simple guards, null checks, and one-or-two-branch native conditions stay
  native.
- No mechanical conversion of working code, and no speculative restriction on
  union size beyond what readability justifies.

## 6. Test Baseline

Tests should precede or accompany each behavior. The initial suite is small but
must cover the failure-prone boundaries.

### 6.1 Runtime tests

`test/runtime.test.ts` covers pure logic without launching Electron:

- Resolves the bundled Node and DSH paths for development and packaged modes,
  including the `runtime-node-entry.mjs` location in each mode.
- Reserves a loopback port by binding `127.0.0.1:0` and closing the temporary
  socket.
- Builds the exact child-process arguments including `--expose-internals`,
  the resolved `runtime-node-entry.mjs` path, and the concrete reserved port.
- Polls HTTP 2xx at the exact origin and rejects non-loopback origins.
- Parses the `[desktop] endpoint http://127.0.0.1:<port>` log line.
- Distinguishes deliberate shutdown from a crash.
- Enforces the bounded startup and shutdown constants from
  `src/shared/contracts.ts`.

### 6.2 Security policy tests

`test/security-policy.test.ts` covers:

- Only the exact current DSH origin and the exact splash file URL are trusted
  in-app.
- External HTTP and HTTPS URLs are not loaded inside the application.
- Unsupported schemes are denied.
- Webview attachment and unexpected permissions are denied.
- Clipboard-sanitized-write is allowed only for the harness main frame.

### 6.3 Repository contract tests

`test/repository-contract.test.ts` reads repository files and asserts:

- `package.json` and `package-lock.json` versions agree.
- The exact pins in section 5.1 are present.
- Lifecycle constants live in `src/shared/contracts.ts` and the security policy
  in `src/main/security-policy.ts`.
- Packaging scripts contain `--publish never`.
- Windows target is NSIS x64 only.
- Workflow artifact upload fails when the installer is missing.
- README documents the unsigned-build limitation and quality commands.
- Workflows request no write permissions during the private validation stage.
- `.run()` does not appear in source under the ts-pattern policy.
- The electron-builder config matches the packaging contract in section 3.5
  (asar false, npmRebuild false, extraResources, NSIS x64 only, no publish key).

### 6.4 Packaged smoke

The Windows packaging workflow performs the end-to-end gate that unit tests
cannot provide. It discovers the endpoint from the harness log line
`[desktop] endpoint http://127.0.0.1:<port>` and polls HTTP 2xx at that exact
origin:

1. Build `win-unpacked` and the NSIS installer.
2. Start the unpacked application and discover the DSH loopback endpoint from
   the log line.
3. Exercise a keyless workspace/session RPC when the official version supports
   it; otherwise require a stable HTTP response and record the reduced gate.
4. Verify no early child exit or stderr fatal marker.
5. Silently install NSIS into a temporary directory.
6. Start the installed application and repeat the readiness check.
7. Close gracefully and verify no DSH Node process remains.

The installed-application check is mandatory because a valid builder output can
still contain paths or links that break only after installation.

No browser E2E suite, snapshot suite, or coverage threshold is required for the
first milestone.

## 7. Documentation Baseline

The repository should maintain only documentation with a clear owner:

- `README.md`: purpose, prerequisites, local commands, quality gate, packaging,
  project structure, and unsigned-installer warning.
- `docs/architecture.md`: process boundaries, runtime paths, security policy,
  data ownership, and shutdown semantics.
- `docs/testing.md`: unit, contract, and Windows smoke responsibilities.
- This initialization plan: approved scope and sequencing contract for `v0.0.1`.

Documentation must describe current behavior. Planned behavior remains in this
document until implemented.

A bilingual README, contributing guide, release guide, and changelog are deferred
until the project is ready for public contributors or public releases.

## 8. Workflow Baseline

### 8.1 `ci.yml`

Runs on pull requests and pushes to `master` using `windows-latest` with
read-only repository permissions:

```text
checkout
setup-node with npm cache
npm ci
npm test
npm run typecheck
npm run build
```

It does not package, publish, sign, or upload release assets. This keeps the
ordinary development gate fast and deterministic.

### 8.2 `windows-package.yml`

Initially runs only through `workflow_dispatch` with read-only repository
permissions:

```text
checkout
setup-node with npm cache
npm ci
npm test
npm run typecheck
npm run package:win
win-unpacked smoke (endpoint from log, HTTP 2xx)
silent NSIS install
installed-application smoke (endpoint from log, HTTP 2xx)
graceful close and orphan-process check
upload unsigned installer artifact
```

The workflow must set `--publish never`, use `if-no-files-found: error`, impose
explicit timeouts, and upload diagnostics on failure. It does not create a
GitHub Release. `scripts/verify-target.mjs` is invoked before packaging to
assert the configured Windows target.

Tag triggers are introduced only after the private review gates are stable and
the user explicitly approves a release process.

## 9. Implementation Sequence

### Stage A: Repository foundation

- Add npm, TypeScript, electron-vite, Vitest, and builder manifests with the
  exact pins from section 5.1.
- Add exact app identity and version `0.0.1`.
- Add the contract-test skeleton and `ci.yml`.
- Gate: clean install, test, typecheck, and build pass on Windows CI.

### Stage B: Minimal secure shell

- Implement process identity, hardened BrowserWindow, and the exact-origin
  security policy.
- Add runtime path, port reservation, and readiness helpers with unit tests.
- Load the static `build/splash.html` only until DSH readiness exists.
- Gate: no preload, no Node access from the renderer; tests prove the
  exact-origin policy.

### Stage C: Official DSH integration

- Pin the selected official DSH and ordinary Node versions.
- Reserve a loopback port, spawn DSH through `runtime-node-entry.mjs`, and poll
  HTTP 2xx at the exact origin.
- Add logs, startup failure diagnostics, and process-tree shutdown.
- Gate: local development reaches the official DSH Web UI without system Node.

### Stage D: Windows installer proof

- Add Windows x64 NSIS config and `scripts/verify-target.mjs` target
  verification.
- Add `windows-package.yml` and the two-level smoke test.
- Gate: a clean Windows runner installs, launches, reaches DSH, exits cleanly,
  and uploads one unsigned installer.

No later stage begins while the preceding gate is red.

## 10. Explicitly Out of Scope for `v0.0.1`

- Forked or locally built DSH.
- Runtime workspace assembly or tarball closure generation.
- Bundled pnpm or arbitrary plugin installation.
- OCR, Tesseract, vision seed, or default plugins.
- Custom renderer, onboarding wizard, or duplicated settings UI.
- Preload bridge and renderer-side IPC.
- Tray residence, launch-at-login, deep links, or mobile pairing.
- Auto-update, release publishing, download mirrors, or analytics.
- Code signing, notarization, or certificate secrets.
- macOS, Linux, Windows ARM64, portable ZIP, MSI, or Store packages.
- Backward compatibility for unreleased formats.

## 11. Review Decisions

The following decisions are confirmed for implementation:

- Product name: `DSH Flightdeck`.
- npm package name: `dsh-flightdeck`.
- Application ID: `dev.zeno.dsh-flightdeck`.
- Initial package version: `0.0.1`.
- Default branch: `master`.
- Package manager: npm.
- First platform: Windows x64.
- Distribution target: unsigned NSIS artifact from private CI.
- DSH source: exact official `@deepseek-ai/dsh@0.1.0-rc.7`.
- Repository remains private until the user reviews runtime behavior, licensing,
  secrets, installer disclosure, and CI evidence.

## 12. Acceptance Criteria for the Initialization Plan

The initialization plan is approved for implementation. The v0.0.1 milestone is
verified against these gates:

- Repository scope and exclusions are unambiguous.
- Tests, documentation, and workflows each have a minimum owned surface.
- Windows packaging includes both unpacked and installed smoke gates.
- No publication, signing, updater, or cross-platform work is implied.
- The primary reference is pinned and copied as patterns rather than branding or
  product-specific code.
- Reserved-port startup is in place: `127.0.0.1:0` reserves a concrete port, the
  temporary socket is closed, the concrete port is passed to DSH, and HTTP 2xx
  is polled at the exact origin.
- Exact-origin policy is in place: only the exact current
  `http://127.0.0.1:<port>` origin and the exact splash file URL load in-app;
  external HTTP(S) opens through the system shell; other protocols and webviews
  are denied.
