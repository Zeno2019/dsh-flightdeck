# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/version-0.1.0--rc.7-blue" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

面向非程序人员的 DeepSeek Harness (DSH) Web UI 桌面启动器。双击安装,整个 DSH 环境——桌面窗口、运行时、一组优选插件——首次启动即就绪。

**预装优选插件,开箱即用(首次启动自动激活):**

- `dshmarket` 1.14.1 —— 插件市场
- `dsh-find-plugin` 0.3.7 —— 按名称或关键词查找插件
- `dsh-anchored-subagent` 0.3.0 —— 每个会话首请求以 Minimal 双工具集条件启动,再解锁完整工具目录
- `dsh-better-sidebar` 0.13.1 —— 织入 web UI 的 VSCode 式右侧栏(文件树、编辑器、终端、git 面板)

你的 profile 存放在应用自己的 user-data 目录下,应用更新绝不覆盖;插件版本随每次构建冻结分发。

## 下载与安装

从 [Releases](https://github.com/Zeno2019/dsh-flightdeck/releases) 获取最新预发布版:

- **Windows x64** —— 运行安装 exe。安装器未签名,SmartScreen 可能警告:选择*更多信息 → 仍要运行*。
- **macOS arm64(Apple Silicon)** —— 打开 dmg,把应用拖进 `/Applications`。应用未签名,Gatekeeper 会拦截首次启动:在 Finder 中右键点应用并选择「打开」,或在终端执行一次: `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app`。暂不支持 Intel Mac。

首次启动先显示短暂的 splash 页,随后进入 DSH Web UI。就这样。

## 定位

- **做什么**: 面向非程序人员的 DSH 桌面启动器——双击安装,预装优选插件,开箱即用。
- **不做什么**: 它不是 DSH 或 DeepSeek 本体,也不是替代品;不做深度主题定制,也不面向开发者提供其他深度定制入口。
- **可能会做**(不作承诺): 更多预装插件;界面本地化;更多平台。

## 故障排查

- macOS 首次启动被拦截,或提示应用「已损坏」→ 执行上面的 `xattr` 命令即可。
- 以 `github:` 地址形式安装插件需要本机有 git 二进制(从市场安装不需要)。
- 反馈问题时,请附上应用 user-data 目录下的 `logs/harness.log`——运行时的全部输出都在里面。

## 文档

文档以中文为主,另附英文架构文档:

- [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) —— 架构说明(中文)
- [docs/project-structure.md](docs/project-structure.md) —— 项目结构、CI 工作流与构建指南(中文,开发向)
- [docs/testing.md](docs/testing.md) —— 测试与冒烟职责
- [docs/architecture.md](docs/architecture.md) —— architecture(英文)
