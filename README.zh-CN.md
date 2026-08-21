# dsh-flightdeck

<p align="center"><img src="build/icon.png" width="128" alt="DSH Flightdeck" /></p>

<p align="center">
  <a href="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml"><img src="https://github.com/Zeno2019/dsh-flightdeck/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/Flightdeck-0.1.3-blue" alt="Flightdeck 0.1.3" />
  <img src="https://img.shields.io/badge/Bundled_DSH-0.1.0--rc.7-5b5bd6" alt="Bundled DSH 0.1.0-rc.7" />
  <img src="https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-lightgrey" alt="Platforms" />
</p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

面向非程序人员的 DeepSeek Harness (DSH) Web UI 桌面启动器。双击安装,整个 DSH 环境——桌面窗口、运行时、一组优选插件——首次启动即就绪。

**预装优选插件,开箱即用(首次启动自动激活):**

- `dshmarket` —— 插件市场
- `dsh-find-plugin` —— 按名称或关键词查找插件
- `dsh-anchored-subagent` —— 每个会话首请求以 Minimal 双工具集条件启动,再解锁完整工具目录
- `dsh-better-sidebar` —— 织入 web UI 的 VSCode 式右侧栏(文件树、编辑器、终端、git 面板)

应用、DSH 核心与插件的内置版本按发布精确锁定,以 [Releases](https://github.com/Zeno2019/dsh-flightdeck/releases) 页面各版本的矩阵为准。

你的 profile 存放在应用自己的 user-data 目录下,应用更新不会覆盖它。全新安装使用该构建随附的插件版本;更新后的既有 profile 可能继续保留旧版或用户自行管理的插件。

## 兼容性

**兼容性说明:** 发布测试仅覆盖 Windows x64 与 macOS arm64 上的安装/解包、应用启动、DSH HTTP 就绪和打包文件检查,不代表每项插件功能、所有系统环境、网络条件或用户自行管理的插件都经过完整验证。

安装、升级或替换其他插件前,请先确认插件声明支持随附的 DSH 核心,并备份 profile。既有 profile 会在应用更新后保留,因此其中实际生效的插件版本可能与某次发布的全新安装默认值不同。

## 下载与安装

从 [Releases](https://github.com/Zeno2019/dsh-flightdeck/releases) 获取最新 stable 正式版。

安装包均未签名:Windows 没有 Authenticode 签名,SmartScreen 可能警告;确认下载的是目标 Release 资产后,选择「更多信息 → 仍要运行」。macOS 没有 Developer ID 签名或 notarization,Gatekeeper 可能拦截首次启动;在 Finder 中右键应用选择「打开」,或到「系统设置 → 隐私与安全性」对这个应用选择「仍要打开」。也可只针对该应用执行: `xattr -d com.apple.quarantine /Applications/DSH\ Flightdeck.app`。不要全局关闭 Gatekeeper。暂不支持 Intel Mac。

首次启动先显示短暂的 splash 页,随后进入 DSH Web UI。UI endpoint 使用本机 loopback;但 DSH、模型 provider 和插件仍可能访问网络。

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