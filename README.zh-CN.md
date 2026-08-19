# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/version-0.1.0--rc.6-blue" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

围绕官方 DeepSeek Harness (DSH) Web UI 构建的轻量私有 Electron 封装。Electron 负责桌面窗口、DSH 子进程生命周期、本地就绪探测、日志与 Windows 打包;不接管 DSH 的包依赖图,也不重新构建上游 monorepo。

## 锁定版本

运行时输入在 `package.json` 与 `package-lock.json` 中精确锁定:

- `@deepseek-ai/dsh` 0.1.0-rc.7
- `node` 24.19.0(内置的平台 Node 二进制)
- `ts-pattern` 5.9.0

开发工具链: electron 43.4.0、electron-builder 26.15.3、electron-vite 5.0.0、patch-package 8.0.1、typescript 5.9.3、vitest 4.1.10、@types/node 24.10.1。

`patch-package` 会在安装时重新应用 `patches/@deepseek-ai+dsh-app-boot+0.1.0-rc.7.patch`:它修复 DSH profile 的模块回退,使 Windows NTFS 目录联接 (directory junction) 被识别并用 `rmdirSync`(而非 `unlinkSync`)删除。

## 打包运行时闭包

electron-builder 的生产依赖收集器会丢弃仅经 `peerDependencies` 可达的包,因此 `@deepseek-ai/dsh` 的完整 peer 闭包(含 `dsh` 本体在内共 20 个 `@deepseek-ai` 包)被固定为 `package.json` 中的直接依赖。两条打包工作流在每次冒烟前都会将打包产物树与仓库 `node_modules/@deepseek-ai` 闭包比对(`Assert-PackagedRuntimeClosure`),因此未来 DSH 升级若改变 peer 闭包,会在打包阶段直接报错。

## 内置插件

安装包内置三个经审核的 DSH 插件，作为首次启动的 web profile 种子：

- `dshmarket` 1.14.1
- `dsh-find-plugin` 0.3.7
- `dsh-anchored-subagent` 0.3.0 —— 仅发布在 GitHub，经 codeload tarball URL pin 到精确 commit（构建期解析，目标机器无需 git）。每个会话首请求以 Minimal 双工具集条件启动，再解锁完整工具目录

`scripts/prepare-profile-web.mjs` 在打包时把它们暂存为一棵无符号链接的 npm 生产依赖树，连同 profile 清单（模板包加上这三个插件）与一份空的 `cordis.patch.yml`。插件的 peer 依赖刻意不随包分发:运行时从打包的 DSH 闭包解析。首次启动时,仅当 `<userData>/harness/profiles/web` 尚不存在才会复制 profile;之后的启动绝不覆盖用户的改动。插件版本冻结在 prepare 脚本里--要升级就在那里改并重新构建。日后增删插件需要本机装有 pnpm(上游 `dsh plugin` 路径)。

## 前置条件

- 开发需要 Node.js >= 22 与 npm。
- 打包需要 Windows x64。`package:dir` 与 `package:win` 会先校验目标,在任何其他平台或架构上快速失败。
- 打包需要 Apple Silicon 的 macOS。`package:mac:dir` 与 `package:mac` 会先校验目标,在任何其他平台或架构上快速失败。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 依据提交的 lockfile 干净安装 |
| `npm run dev` | 启动 electron-vite 开发外壳 |
| `npm test` | 完整运行一次 Vitest 套件 |
| `npm run typecheck` | 运行 `tsc --noEmit` |
| `npm run build` | 用 electron-vite 编译主进程产物 |
| `npm run package:dir` | 以 `--publish never` 构建未打包的 Windows x64 应用 |
| `npm run package:win` | 以 `--publish never` 构建 Windows x64 NSIS 安装器 |
| `npm run package:mac:dir` | 以 `--publish never` 构建未打包的 macOS arm64 应用 |
| `npm run package:mac` | 以 `--publish never` 构建 macOS arm64 dmg |

## 打包

打包按平台门控:Windows 命令仅限 x64,macOS 命令仅限 Apple Silicon arm64,各自构建前先校验目标。Windows NSIS 安装器未签名,因此运行时 Windows SmartScreen 会弹出警告。macOS dmg 同样未签名、未公证(见 [macOS](#macos))。项目不做代码签名,也没有自动更新。手动工作流会把安装器作为 artifact 上传;推送 `v*` tag 会触发 `release.yml`,重复同样的冒烟门控流水线,然后把 Windows 安装器与 macOS dmg 发布为 GitHub 预发布资产。

## macOS

macOS 构建仅面向 Apple Silicon (arm64),产物为 `dsh-flightdeck-mac-arm64.dmg`。由于未签名,macOS Gatekeeper 会拦截首次启动:在 Finder 中右键点应用并选择「打开」(或把应用复制到 `/Applications` 后,执行一次 `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app`)。暂不支持 Intel Mac。

无需安装 Node.js、pnpm 或 Homebrew:打包应用内置 Node 二进制,并在启动时向 DSH 子进程环境写入可执行的 `pnpm`/`dsh` 启动器,与 Windows 侧的 cmd 垫片一致。装有 Homebrew 的机器还能顺带满足 dshmarket 自身的 `/opt/homebrew/bin` PATH 探测。`github:` 形式的插件安装仍需要本机有 git。

## Windows 冒烟工作流

`.github/workflows/windows-package.yml` 由 `workflow_dispatch` 触发:构建安装器后,对未打包应用与静默安装的应用分别冒烟。每个阶段使用独立的 user-data 目录 (`DSH_FLIGHTDECK_USER_DATA`),工作流从 harness 日志里发现 DSH loopback endpoint,轮询 HTTP 2xx,优雅关闭应用,并确认没有 DSH Node 进程残留。`.github/workflows/release.yml` 在 `v*` tag 上运行同一条流水线并发布预发布。`.github/workflows/mac-package.yml` 是 macOS 侧对应工作流:在 `macos-latest` 上构建未签名 dmg,再对未打包的 `.app` 与从挂载 dmg 安装出来的副本分别冒烟,并把 dmg 作为 artifact 上传。`release.yml` 中的 `release-mac` job 会在打 tag 推送时重复该流水线,把 dmg 附加到 GitHub 预发布上。

2026-08-19 实测通过 (master@71d55e1):两处 runtime closure 通知均报告 195 个 `@deepseek-ai` 包,两次冒烟均达到 HTTP 2xx。安装器随后在一台真实 Windows 机器上完成验证——向导安装、启动、单实例二次启动、干净卸载,内置 ripgrep 1.18.0 齐全。

## 项目结构

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

`out/`、`dist/`、`node_modules/` 为生成产物,已被忽略。进程与安全细节见 `docs/architecture.md`,测试与冒烟职责见 `docs/testing.md`。
