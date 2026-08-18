# dsh-flightdeck

Private thin Electron wrapper around the official DeepSeek Harness (DSH) Web UI. Electron owns the desktop window, the DSH child-process lifecycle, local readiness, logging, and Windows packaging. It does not own the DSH package graph and does not rebuild the upstream monorepo.

## Pinned versions

The runtime inputs are pinned exactly in `package.json` and `package-lock.json`:

- `@deepseek-ai/dsh` 0.1.0-rc.7
- `node` 24.19.0 (bundled platform Node binary)
- `ts-pattern` 5.9.0

Development toolchain: electron 43.4.0, electron-builder 26.15.3, electron-vite 5.0.0, typescript 5.9.3, vitest 4.1.10, @types/node 24.10.1.

## Prerequisites

- Node.js >= 22 and npm for development.
- Windows x64 for packaging. `package:dir` and `package:win` verify the target first and fail fast on any other platform or architecture.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Clean install from the committed lockfile |
| `npm run dev` | Start the electron-vite development shell |
| `npm test` | Run the Vitest suite once |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run build` | Compile the main-process output with electron-vite |
| `npm run package:dir` | Build an unpacked Windows x64 app with `--publish never` |
| `npm run package:win` | Build the Windows x64 NSIS installer with `--publish never` |

## Packaging

Both packaging commands are Windows-x64-only. The NSIS installer is unsigned, so Windows SmartScreen shows a warning when it runs. There is no code signing, no auto-update, and no release publishing. CI uploads the installer as an artifact only.

## Windows smoke workflow

`.github/workflows/windows-package.yml` runs on `workflow_dispatch`. It builds the installer, then smokes both the unpacked and the silently installed application: it discovers the DSH loopback endpoint from the harness log, polls HTTP 2xx, closes the app gracefully, and verifies no DSH Node process remains. This workflow has not been executed or proven in this local macOS session.

## Project structure

```text
dsh-flightdeck/
  .github/workflows/
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
    repository-reader.ts
    runtime.test.ts
    security-policy.test.ts
  electron.vite.config.ts
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.node.json
```

`out/`, `dist/`, and `node_modules/` are generated and ignored. See `docs/architecture.md` for process and security details, and `docs/testing.md` for the test and smoke responsibilities.
