# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Flightdeck-0.1.0--rc.9-blue" alt="Flightdeck 0.1.0-rc.9" />
  <img src="https://img.shields.io/badge/Bundled_DSH-0.1.0--rc.7-5b5bd6" alt="Bundled DSH 0.1.0-rc.7" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

A desktop launcher for the DeepSeek Harness (DSH) Web UI, made for people who don't program. Double-click the installer and the whole DSH environment — desktop window, runtime, and a curated set of plugins — is ready on first launch.

**Curated plugins, preinstalled and ready on first launch:**

- `dshmarket` 1.14.1 — the plugin marketplace
- `dsh-find-plugin` 0.3.7 — find plugins by name or keyword
- `dsh-anchored-subagent` 0.3.0 — each session opens its first request under a Minimal two-tool set, then unlocks the full tool catalog
- `dsh-better-sidebar` 0.13.1 — a VSCode-style right sidebar (file tree, editor, terminal, git panels) in the web UI

Your profile lives under the app's own user-data directory and is never overwritten by app updates. A fresh installation uses the plugin versions bundled with that build; an existing profile can retain older or user-managed plugin versions after an update.

## Version & compatibility

**RC.9 is a prerelease, not a stable release.**

| Component | Bundled version |
|---|---:|
| DSH Flightdeck | `0.1.0-rc.9` |
| DSH core | `0.1.0-rc.7` |
| `dshmarket` | `1.14.1` |
| `dsh-find-plugin` | `0.3.7` |
| `dsh-anchored-subagent` | `0.3.0` (`31fdd22a4265aef3107d9fca05854bea78a9af10`) |
| `dsh-better-sidebar` | `0.13.1` |

**Compatibility notice:** Release testing is limited to installation/unpacking, application startup, DSH HTTP readiness, and packaged-file checks on Windows x64 and macOS arm64. It does not represent complete validation of every plugin feature, system environment, network condition, or user-managed plugin.

Before installing, upgrading, or replacing another plugin, verify that it declares support for DSH `0.1.0-rc.7` and back up the profile. Existing profiles are preserved across app updates, so their effective plugin versions can differ from the fresh-install matrix above.

## Download & install

Grab the RC.9 prerelease from [Releases](https://github.com/Zeno2019/dsh-flightdeck/releases). RC.9 is not stable and is not a promise of complete plugin or platform compatibility.

The exact release assets are:

- **Windows x64** — `dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-windows-x64-setup.exe`
- **macOS arm64 (Apple Silicon)** — `dsh-flightdeck-0.1.0-rc.9-dsh-0.1.0-rc.7-mac-arm64.dmg`

The packages are unsigned: Windows has no Authenticode signature, so SmartScreen may warn; choose *More info → Run anyway* only after confirming that you downloaded the intended Release asset. macOS has no Developer ID signature or notarization, so Gatekeeper may block the first launch; in Finder, right-click the app and choose *Open*, or use **System Settings → Privacy & Security → Open Anyway** for this app. A targeted alternative is `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app`. Do not disable Gatekeeper globally. Intel Macs are not supported yet.

First launch shows a brief splash page, then the DSH Web UI. The UI endpoint is local loopback; DSH, model providers, and plugins may still use the network.

## Positioning

- **Does**: a DSH desktop launcher for non-programmers — double-click install, curated plugins preinstalled, works out of the box.
- **Does not**: it is not DSH or DeepSeek itself, nor a replacement; it offers no deep theme customization or other deep-customization entry aimed at developers.
- **Might do** (no promises): more preinstalled plugins; a localized interface; more platforms.

## Troubleshooting

- macOS first launch blocked, or an app "damaged" warning → the `xattr` command above fixes it.
- Installing a plugin by its `github:` address needs a local git binary (marketplace installs don't).
- When reporting issues, include the Flightdeck version, bundled DSH version, OS/architecture, actual plugin versions, whether the profile is fresh, and `logs/harness.log` from the app's user-data directory.

## License

Original DSH Flightdeck code is licensed under the [Apache License 2.0](LICENSE). DSH, bundled plugins, and other third-party components remain subject to their respective licenses; the Apache-2.0 license does not replace third-party licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Documentation

Docs are Chinese-first; the English architecture doc is included:

- [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) — 架构说明(中文)
- [docs/project-structure.md](docs/project-structure.md) — 项目结构、CI 工作流与构建指南(中文,开发向)
- [docs/testing.md](docs/testing.md) — 测试与冒烟职责
- [docs/architecture.md](docs/architecture.md) — architecture (English)
