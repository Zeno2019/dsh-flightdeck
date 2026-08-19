# dsh-flightdeck

Private thin Electron wrapper around the official DeepSeek Harness (DSH) Web UI. Electron owns the desktop window, the DSH child-process lifecycle, local readiness, logging, and Windows packaging. It does not own the DSH package graph and does not rebuild the upstream monorepo.

## Pinned versions

The runtime inputs are pinned exactly in `package.json` and `package-lock.json`:

- `@deepseek-ai/dsh` 0.1.0-rc.7
- `node` 24.19.0 (bundled platform Node binary)
- `ts-pattern` 5.9.0

Development toolchain: electron 43.4.0, electron-builder 26.15.3, electron-vite 5.0.0, patch-package 8.0.1, typescript 5.9.3, vitest 4.1.10, @types/node 24.10.1.

`patch-package` reapplies `patches/@deepseek-ai+dsh-app-boot+0.1.0-rc.7.patch` on install: it repairs the DSH profile module-fallback so Windows NTFS directory junctions are recognized and removed with `rmdirSync` instead of `unlinkSync`.

## Packaged runtime closure

electron-builder's production collector drops packages reachable only through `peerDependencies`, so the full peer closure of `@deepseek-ai/dsh` (20 `@deepseek-ai` packages including `dsh` itself) is pinned as direct dependencies in `package.json`. Both package workflows verify the packaged tree against the repository `node_modules/@deepseek-ai` closure before every smoke (`Assert-PackagedRuntimeClosure`), so a future DSH upgrade that changes the peer closure fails loudly at packaging time.

## Bundled plugins

The installer vendors two approved DSH plugins as a first-launch web profile seed:

- `dshmarket` 1.14.1
- `dsh-find-plugin` 0.3.6

`scripts/prepare-profile-web.mjs` stages them at packaging time as a symlink-free npm production tree with the profile manifest (template bundles plus the two plugins) and an empty `cordis.patch.yml`. Plugin peer dependencies are deliberately not vendored: they resolve at runtime from the packaged DSH closure. On first launch the app copies the profile into `<userData>/harness/profiles/web` only when it does not exist yet; later launches never overwrite user changes. Plugin versions are frozen in the prepare script — bump them there and rebuild. Adding or removing plugins later needs pnpm on the machine (the upstream `dsh plugin` path).

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

Both packaging commands are Windows-x64-only. The NSIS installer is unsigned, so Windows SmartScreen shows a warning when it runs. There is no code signing and no auto-update. The manual workflow uploads the installer as an artifact; a `v*` tag push runs `release.yml`, which repeats the same smoke-gated pipeline and then publishes the setup executable as a GitHub prerelease.

## Windows smoke workflow

`.github/workflows/windows-package.yml` runs on `workflow_dispatch`. It builds the installer, then smokes both the unpacked and the silently installed application: each phase gets its own user-data directory (`DSH_FLIGHTDECK_USER_DATA`), the workflow discovers the DSH loopback endpoint from the harness log, polls HTTP 2xx, closes the app gracefully, and verifies no DSH Node process remains. `.github/workflows/release.yml` runs the same pipeline on `v*` tags and publishes the prerelease.

Executed successfully on 2026-08-19 (master@71d55e1): both runtime closure notices reported 195 `@deepseek-ai` packages and both smokes reached HTTP 2xx. The installer was then verified on a real Windows machine — wizard install, launch, single-instance second launch, clean uninstall, and bundled ripgrep 1.18.0 present.

## Project structure

```text
dsh-flightdeck/
  .github/workflows/
    ci.yml
    release.yml
    windows-package.yml
  build/
    runtime-node-entry.mjs
    splash.html
  docs/
    architecture.md
    engineering-initialization-v0.0.1.md
    testing.md
  patches/
    @deepseek-ai+dsh-app-boot+0.1.0-rc.7.patch
  scripts/
    prepare-profile-web.mjs
    verify-target.mjs
  src/
    main/
      index.ts
      profile-seed.ts
      reserve-port.ts
      runtime.ts
      runtime-paths.ts
      security-policy.ts
      security.ts
    shared/
      contracts.ts
  test/
    profile-fallback.test.ts
    profile-seed.test.ts
    repository-contract.test.ts
    repository-reader.ts
    runtime-entry.test.ts
    runtime.test.ts
    security-policy.test.ts
  electron.vite.config.ts
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.node.json
```

`out/`, `dist/`, and `node_modules/` are generated and ignored. See `docs/architecture.md` for process and security details, and `docs/testing.md` for the test and smoke responsibilities.
