# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Flightdeck-0.1.0--rc.8-blue" alt="Flightdeck 0.1.0-rc.8" />
  <img src="https://img.shields.io/badge/Bundled_DSH-0.1.0--rc.7-5b5bd6" alt="Bundled DSH 0.1.0-rc.7" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

面向非程序人员的 DeepSeek Harness (DSH) Web UI 桌面启动器。双击安装,整个 DSH 环境——桌面窗口、运行时、一组优选插件——首次启动即就绪。

**预装优选插件,开箱即用(首次启动自动激活):**

- `dshmarket` 1.14.1 —— 插件市场
- `dsh-find-plugin` 0.3.7 —— 按名称或关键词查找插件
- `dsh-anchored-subagent` 0.3.0 —— 每个会话首请求以 Minimal 双工具集条件启动,再解锁完整工具目录
- `dsh-better-sidebar` 0.13.1 —— 织入 web UI 的 VSCode 式右侧栏(文件树、编辑器、终端、git 面板)

你的 profile 存放在应用自己的 user-data 目录下,应用更新不会覆盖它。全新安装使用该构建随附的插件版本;更新后的既有 profile 可能继续保留旧版或用户自行管理的插件。

## 版本与兼容性

| 组件 | 随附版本 |
|---|---:|
| DSH Flightdeck | `0.1.0-rc.8` |
| DSH 核心 | `0.1.0-rc.7` |
| `dshmarket` | `1.14.1` |
| `dsh-find-plugin` | `0.3.7` |
| `dsh-anchored-subagent` | `0.3.0` (`31fdd22a4265aef3107d9fca05854bea78a9af10`) |
| `dsh-better-sidebar` | `0.13.1` |

**兼容性说明:** 发布测试仅覆盖 Windows x64 与 macOS arm64 上的安装/解包、应用启动、DSH HTTP 就绪和打包文件检查,不代表每项插件功能、所有系统环境、网络条件或用户自行管理的插件都经过完整验证。

安装、升级或替换其他插件前,请先确认插件声明支持 DSH `0.1.0-rc.7`,并备份 profile。既有 profile 会在应用更新后保留,因此其中实际生效的插件版本可能与上面的全新安装矩阵不同。

## 下载与安装

从 [Releases](https://github.com/Zeno2019/dsh-flightdeck/releases) 获取最新预发布版:

- **Windows x64** —— 运行安装 exe。安装器未签名,SmartScreen 可能警告:选择*更多信息 → 仍要运行*。
- **macOS arm64(Apple Silicon)** —— 打开 dmg,把应用拖进 `/Applications`。应用未签名,Gatekeeper 会拦截首次启动:在 Finder 中右键点应用并选择「打开」,或在终端执行一次: `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app`。暂不支持 Intel Mac。

首次启动先显示短暂的 splash 页,随后进入 DSH Web UI。

## 定位

- **做什么**: 面向非程序人员的 DSH 桌面启动器——双击安装,预装优选插件,开箱即用。
- **不做什么**: 它不是 DSH 或 DeepSeek 本体,也不是替代品;不做深度主题定制,也不面向开发者提供其他深度定制入口。
- **可能会做**(不作承诺): 更多预装插件;界面本地化;更多平台。

## 故障排查

- macOS 首次启动被拦截,或提示应用「已损坏」→ 执行上面的 `xattr` 命令即可。
- 以 `github:` 地址形式安装插件需要本机有 git 二进制(从市场安装不需要)。
- 反馈问题时,请提供 Flightdeck 版本、内置 DSH 版本、系统与架构、实际插件版本、是否为全新 profile,以及应用 user-data 目录下的 `logs/harness.log`。

## 许可证

DSH Flightdeck 的原创代码采用 [Apache License 2.0](LICENSE)。DSH、预装插件及其他第三方组件继续遵循各自的许可证;Apache-2.0 声明不会替代第三方许可证。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 文档

文档以中文为主,另附英文架构文档:

- [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) —— 架构说明(中文)
- [docs/project-structure.md](docs/project-structure.md) —— 项目结构、CI 工作流与构建指南(中文,开发向)
- [docs/testing.md](docs/testing.md) —— 测试与冒烟职责
- [docs/architecture.md](docs/architecture.md) —— architecture(英文)
