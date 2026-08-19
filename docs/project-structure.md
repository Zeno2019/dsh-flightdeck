# 项目结构与构建(开发向)

> 本文档面向开发者:仓库结构、CI 工作流、开发与打包指南。应用定位与安装说明见 [README.zh-CN.md](../README.zh-CN.md);进程与安全细节见 [architecture.zh-CN.md](architecture.zh-CN.md);测试职责见 [testing.md](testing.md)。本文仅为描述,权威来源以代码为准。

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
    architecture.zh-CN.md
    engineering-initialization-v0.0.1.md
    project-structure.md
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

`out/`、`dist/`、`build/profile-web/` 与 `node_modules/` 为生成产物,已被忽略。

## 锁定版本

运行时输入在 `package.json` 与 `package-lock.json` 中精确锁定:

- `@deepseek-ai/dsh` 0.1.0-rc.7
- `node` 24.19.0(内置的平台 Node 二进制)
- `ts-pattern` 5.9.0

开发工具链: electron 43.4.0、electron-builder 26.15.3、electron-vite 5.0.0、patch-package 8.0.1、typescript 5.9.3、vitest 4.1.10、@types/node 24.10.1。

`patch-package` 在安装时重放 `patches/@deepseek-ai+dsh-app-boot+0.1.0-rc.7.patch`,修复 Windows NTFS directory junction 的识别与删除(细节见 [architecture.zh-CN.md](architecture.zh-CN.md) 的「Vendored 依赖修复」节)。

内置插件的版本(dshmarket 1.14.1 / dsh-find-plugin 0.3.7 / dsh-anchored-subagent 0.3.0 / dsh-better-sidebar 0.13.1)冻结在 `scripts/prepare-profile-web.mjs` 的 pin map 中;升级插件就在那里改版本并重新构建。peer 闭包与 plugin seed 机制见 [architecture.zh-CN.md](architecture.zh-CN.md)。

## 前置条件

- 开发需要 Node.js >= 22 与 npm。
- 打包 Windows x64:`package:dir` 与 `package:win` 先校验目标,在其他平台或架构上快速失败。
- 打包 macOS arm64(Apple Silicon):`package:mac:dir` 与 `package:mac` 先校验目标,在其他平台或架构上快速失败。

## 开发命令

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

打包按平台门控:Windows 命令仅限 x64,macOS 命令仅限 Apple Silicon arm64,各自构建前先校验目标。打包脚本会先跑 `scripts/prepare-profile-web.mjs` 暂存插件种子,再 electron-builder。产物名:`dsh-flightdeck-mac-${arch}.dmg` 与 `dsh-flightdeck-windows-${arch}-setup.exe`。macOS dmg 首启需 Gatekeeper 放行(用户向说明见 README)。macOS 目标机上 dshmarket 会探测 PATH 中的 `/opt/homebrew/bin`:装了 Homebrew 的机器天然满足该探测,但应用本身不依赖 Homebrew。

## CI 工作流

- **ci.yml**:master push 与全部 PR 触发,在 `windows-latest` 上跑 `npm ci` → `npm test` → `npm run typecheck` → `npm run build`。
- **windows-package.yml**:`workflow_dispatch` 手动触发。构建安装器后,对未打包应用与静默安装的应用分别冒烟:每阶段独立 user-data 目录(`DSH_FLIGHTDECK_USER_DATA`),从 harness 日志发现 DSH loopback endpoint,轮询 HTTP 2xx,优雅关闭,并确认无 DSH Node 进程残留。
- **mac-package.yml**:macOS 侧对应工作流,在 `macos-latest` 上构建未签名 dmg,对未打包 `.app` 与从挂载 dmg 安装的副本分别冒烟,上传 dmg 为 artifact。
- **release.yml**:推送 `v*` tag 触发。重复同样的冒烟门控流水线,把 Windows 安装器与 macOS dmg 发布为 GitHub 预发布资产;其中 `release-mac` job 在 Windows 发布后重复 macOS 流水线并附加 dmg。

冒烟执行记录:2026-08-19(master@71d55e1)两处 runtime closure 通知均报告 195 个 `@deepseek-ai` 包,两次冒烟均达 HTTP 2xx;安装器随后在真实 Windows 机器上完成向导安装、启动、单实例二次启动、干净卸载与内置 ripgrep 1.18.0 验证。

## 测试

单元测试与冒烟的职责划分见 [testing.md](testing.md)。仓库契约(`test/repository-contract.test.ts`)pin 了 workflow 断言、插件版本与关键文案——改动这些内容时需同步更新契约测试。
