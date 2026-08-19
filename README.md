# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/version-0.1.0--rc.6-blue" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

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

The installer vendors three approved DSH plugins as a first-launch web profile seed:

- `dshmarket` 1.14.1
- `dsh-find-plugin` 0.3.7
- `dsh-anchored-subagent` 0.3.0 — GitHub-only, pinned to commit `31fdd22` through a codeload tarball URL (resolved at packaging time, so the target machine needs no git). Each session opens its first request under a Minimal two-tool set, then unlocks the full tool catalog

`scripts/prepare-profile-web.mjs` stages them at packaging time as a symlink-free npm production tree with the profile manifest (template bundles plus the three plugins) and an empty `cordis.patch.yml`. Plugin peer dependencies are deliberately not vendored: they resolve at runtime from the packaged DSH closure. On first launch the app copies the profile into `<userData>/harness/profiles/web` only when it does not exist yet; later launches never overwrite user changes. Plugin versions are frozen in the prepare script — bump them there and rebuild. Adding or removing plugins later needs pnpm on the machine (the upstream `dsh plugin` path).

## Prerequisites

- Node.js >= 22 and npm for development.
- Windows x64 for packaging. `package:dir` and `package:win` verify the target first and fail fast on any other platform or architecture.
- macOS on Apple Silicon for packaging. `package:mac:dir` and `package:mac` verify the target first and fail fast on any other platform or architecture.

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
| `npm run package:mac:dir` | Build an unpacked macOS arm64 app with `--publish never` |
| `npm run package:mac` | Build the macOS arm64 dmg with `--publish never` |

## Packaging

Packaging is platform-gated: the Windows commands are x64-only, the macOS commands are Apple Silicon arm64-only, and each verifies its target before building. The Windows NSIS installer is unsigned, so Windows SmartScreen shows a warning when it runs. The macOS dmg is unsigned and unnotarized (see [macOS](#macos)). There is no code signing and no auto-update. The manual workflows upload the installers as artifacts; a `v*` tag push runs `release.yml`, which repeats the same smoke-gated pipelines and then publishes the Windows setup executable and the macOS dmg as GitHub prerelease assets.

## macOS

The macOS build targets Apple Silicon (arm64) only and ships as `dsh-flightdeck-mac-arm64.dmg`. Because it is unsigned, macOS Gatekeeper blocks the first launch: right-click the app in Finder and choose Open (or, after copying to `/Applications`, run `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app` once). Intel Macs are not supported yet.

No Node.js, pnpm, or Homebrew is required: the packaged app bundles the Node binary and writes executable `pnpm`/`dsh` launchers into the DSH child environment at startup, exactly like the Windows cmd shims. Machines that do have Homebrew additionally satisfy dshmarket's own `/opt/homebrew/bin` PATH probe. `github:`-form plugin installs still need a local git binary.

## Windows smoke workflow

`.github/workflows/windows-package.yml` runs on `workflow_dispatch`. It builds the installer, then smokes both the unpacked and the silently installed application: each phase gets its own user-data directory (`DSH_FLIGHTDECK_USER_DATA`), the workflow discovers the DSH loopback endpoint from the harness log, polls HTTP 2xx, closes the app gracefully, and verifies no DSH Node process remains. `.github/workflows/release.yml` runs the same pipeline on `v*` tags and publishes the prerelease. `.github/workflows/mac-package.yml` is the macOS counterpart: it builds the unsigned dmg on `macos-latest`, then smokes both the unpacked `.app` and a copy installed from a mounted dmg, and uploads the dmg as an artifact. The `release-mac` job in `release.yml` repeats that pipeline on tagged pushes and attaches the dmg to the GitHub prerelease.

Executed successfully on 2026-08-19 (master@71d55e1): both runtime closure notices reported 195 `@deepseek-ai` packages and both smokes reached HTTP 2xx. The installer was then verified on a real Windows machine — wizard install, launch, single-instance second launch, clean uninstall, and bundled ripgrep 1.18.0 present.

## Project structure

```text
dsh-flightdeck/
  .github/workflows/
    ci.yml
    mac-package.yml
    release.yml
    windows-package.yml
  build/
    icon.png
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
