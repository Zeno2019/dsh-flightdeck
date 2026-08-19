# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/version-0.1.0--rc.6-blue" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

A desktop launcher for the DeepSeek Harness (DSH) Web UI, made for people who don't program. Double-click the installer and the whole DSH environment — desktop window, runtime, and a curated set of plugins — is ready on first launch.

**Curated plugins, preinstalled and ready on first launch:**

- `dshmarket` 1.14.1 — the plugin marketplace
- `dsh-find-plugin` 0.3.7 — find plugins by name or keyword
- `dsh-anchored-subagent` 0.3.0 — each session opens its first request under a Minimal two-tool set, then unlocks the full tool catalog
- `dsh-better-sidebar` 0.13.1 — a VSCode-style right sidebar (file tree, editor, terminal, git panels) in the web UI

Your profile lives under the app's own user-data directory and is never overwritten by app updates; plugin versions ship frozen with each build.

## Download & install

Grab the latest prerelease from [Releases](https://github.com/Zeno2019/dsh-flightdeck/releases):

- **Windows x64** — run the setup exe. It is unsigned, so SmartScreen may warn: choose *More info → Run anyway*.
- **macOS arm64 (Apple Silicon)** — open the dmg and drag the app into `/Applications`. It is unsigned, so Gatekeeper blocks the first launch: right-click the app in Finder and choose *Open*, or run once in a terminal: `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app`. Intel Macs are not supported yet.

First launch shows a brief splash page, then the DSH Web UI. That's it.

## Positioning

- **Does**: a DSH desktop launcher for non-programmers — double-click install, curated plugins preinstalled, works out of the box.
- **Does not**: it is not DSH or DeepSeek itself, nor a replacement; it offers no deep theme customization or other deep-customization entry aimed at developers.
- **Might do** (no promises): more preinstalled plugins; a localized interface; more platforms.

## Troubleshooting

- macOS first launch blocked, or an app "damaged" warning → the `xattr` command above fixes it.
- Installing a plugin by its `github:` address needs a local git binary (marketplace installs don't).
- When reporting issues, attach `logs/harness.log` from the app's user-data directory — it records everything the runtime prints.

## Documentation

Docs are Chinese-first; the English architecture doc is included:

- [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) — 架构说明(中文)
- [docs/project-structure.md](docs/project-structure.md) — 项目结构、CI 工作流与构建指南(中文,开发向)
- [docs/testing.md](docs/testing.md) — 测试与冒烟职责
- [docs/architecture.md](docs/architecture.md) — architecture (English)
