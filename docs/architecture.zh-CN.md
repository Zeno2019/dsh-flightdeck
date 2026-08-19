# 架构

> 本文档是 [architecture.md](architecture.md) 的中文译本,与英文原版逐节对应。本文仅为描述性文档,权威来源见文末列表。

本文描述 DSH Flightdeck 已实现架构。内容仅作描述,权威来源见文末。

## 进程边界

应用只有一个 Electron 进程,即主进程(`src/main/index.ts`)。没有自定义 renderer 源码、没有 preload 脚本、也没有 IPC。唯一的本地页面是静态 splash 页(开发态为 `build/splash.html`,打包态为 `resources/splash.html`)。DSH Web UI 由独立的子进程提供,并在其 loopback origin 上加载进 BrowserWindow。

主进程 spawn 的是一个专用的 Node 二进制,绝不是 Electron 可执行文件。Electron 与普通 Node 可能暴露不同的原生模块 ABI,因此 DSH 的原生依赖始终运行在普通 Node ABI 上。子进程命令为:

```text
<bundled node> --expose-internals <runtime entry> <dsh bin> web --host 127.0.0.1 --port <reserved port>
```

- 内置 node:`node_modules/node/bin/node`(Windows 上为 `node.exe`)。
- Runtime entry:开发态为 `build/runtime-node-entry.mjs`,打包后为 `resources` 下的副本。
- DSH bin:`node_modules/@deepseek-ai/dsh/lib/bin.js`。
- runtime entry 输出 `[desktop-runtime]` 诊断信息,并在 `uncaughtException` 或 `unhandledRejection` 时把进程标记为 fatal,同步把失败原因写入 stderr,使其能在 `process.exit` 后幸存。

## 端口预留流程

端口是预留出来的,绝不从子进程输出中解析:

1. `reserveLoopbackPort()` 在 `127.0.0.1:0` 上绑定一个临时 IPv4 socket,读取操作系统分配的具体端口。
2. 关闭临时 socket。
3. 把具体端口通过 `--port` 传给 DSH。
4. `waitUntilReady()` 轮询 `http://127.0.0.1:<port>` 的 HTTP GET,直到收到 2xx 响应或启动超时。
5. 只有此时窗口才从 splash 页导航到 DSH origin。

harness 会输出 `[desktop] endpoint http://127.0.0.1:<port>`,用于日志与打包态冒烟门控。

## 运行时路径

`src/main/runtime-paths.ts` 按模式与平台解析路径。win32 使用 win32 路径语义与 `node.exe`;其余平台一律使用 POSIX 语义与裸 `node` 二进制。

开发态(`appRoot` 为仓库根目录):

| 路径 | 值 |
| --- | --- |
| nodeExecutable | `<root>/node_modules/node/bin/node` |
| dshBin | `<root>/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| assetsDir | `<root>/build` |
| runtimeEntry | `<root>/build/runtime-node-entry.mjs` |

打包态(`appRoot` 为安装后的 `resources/app`):

| 路径 | 值 |
| --- | --- |
| nodeExecutable | `<resources>/app/node_modules/node/bin/node.exe` |
| dshBin | `<resources>/app/node_modules/@deepseek-ai/dsh/lib/bin.js` |
| assetsDir | `<resources>` |
| runtimeEntry | `<resources>/runtime-node-entry.mjs` |

打包态的资产来自 electron-builder 配置里的 `extraResources`。

## 安全策略

每个 BrowserWindow 都以 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`、`webviewTag: false` 启动。

导航策略是 exact-origin(`src/main/security-policy.ts`):

- 应用内只允许精确的当前 `http://127.0.0.1:<port>` origin 与精确的 splash 文件 URL。
- 外部 HTTP/HTTPS 链接经系统 shell 打开。
- 其余协议与畸形 URL 一律拒绝。
- 阻止 `will-attach-webview`。
- `window.open` 不允许开新窗口;受信 URL 在同一窗口加载。
- 权限:只授予来自 harness origin、main frame 的 `clipboard-sanitized-write`;其余一切通过 permission check 与 request 两个 handler 拒绝。
- 中止类导航错误(`ERR_ABORTED`、errno -3)被忽略。

## 用户数据布局

所有运行时状态位于 Electron user data 目录(`app.getPath("userData")`)之下:

| 路径 | 用途 |
| --- | --- |
| `<userData>/launch` | 子进程工作目录 |
| `<userData>/harness` | DSH 子进程的 `DSH_HOME` |
| `<userData>/logs/harness.log` | 追加式日志,记录子进程 stdout、stderr 与 harness 行 |
| `<userData>/tools` | `pnpm`/`dsh` 启动器(win32 为 `.cmd`,darwin 为 POSIX 垫片),每次启动重写 |

在 app ready 之前,非空的 `DSH_FLIGHTDECK_USER_DATA` 环境变量会覆盖该目录(`app.setPath("userData", ...)`)。打包态冒烟为每个阶段各设一个,使未打包执行与安装后执行绝不共享 `DSH_HOME`、日志或 junction;它同时服务于便携安装。

子进程以 `windowsHide: true`、piped stdio、`NO_COLOR=1` 启动,并从环境中移除 `ELECTRON_RUN_AS_NODE`。输出写入日志文件,并保留最近 200 行的有界环形缓冲。

## Vendored 依赖修复

`@deepseek-ai` 包通过 `patches/` 下的 patch 修复 vendored 依赖,`postinstall` 在每次干净安装时重放补丁。

## 打包运行时闭包

DSH peer-only 闭包(19 个包)在 `package.json` 中声明为直接依赖,确保被打进产物。

生产依赖树由 `scripts/prepare-app-node-modules.mjs` 按 lockfile 安装到 `build/app-prod`,再经 `files` 的 `{from,to}` 条目注入为 `resources/app/node_modules`。`beforeBuild` 钩子返回 false,使 electron-builder 将依赖视为外部已处理、完全跳过其内置的 npm list 收集器——该收集器在 Windows CI runner 上会间歇性挂起。注意不得设置 `npmRebuild: false`:它会在钩子执行前就让 electron-builder 提前返回,静默重新启用收集器。

## Vendored web profile 种子

profile 种子经 `extraResources` 分发、仅首次启动播种、绝不覆盖用户已修改的 profile;运行时不需要 pnpm 与网络。

## Vendored 工具启动器(pnpm + dsh)

打包态由 vendored node 经 `pnpm`/`dsh` 启动器承接插件安装,目标机无需 Node 工具链。

## 启动与关停

启动:

- 请求 single-instance 锁;第二个实例聚焦既有窗口。
- 移除应用菜单。
- 加载并立即显示 splash 页。
- `HarnessRuntime.start()` 创建目录、预留端口、spawn 子进程、轮询就绪。
- 就绪后窗口加载 DSH origin 并显示。
- 启动超时、spawn 失败或子进程意外退出时,弹出错误对话框并退出应用。

关停:

- 拦截 `before-quit`。shell 阶段进入 `quitting`,运行 `runtime.stop()`,然后才允许退出。
- `stop()` 发送 `SIGTERM` 并等待至多 stop grace period;子进程未退出则强杀:Windows 上 `taskkill /PID <pid> /T /F`,其余平台 `SIGKILL`。
- 主动停止与崩溃分开记录,预期内的退出绝不触发失败对话框。
- `window-all-closed` 退出应用。

生命周期常量位于 `src/shared/contracts.ts`:

| 常量 | 值 |
| --- | --- |
| Windows 启动超时 | 120 s |
| 默认启动超时 | 45 s |
| 就绪轮询间隔 | 250 ms |
| HTTP 请求超时 | 1 s |
| Stop grace period | 4 s |
| 进度日志间隔 | 10 s |
| 日志保留最大行数 | 200 |

Runtime 阶段:`idle`、`starting`、`ready`、`stopping`、`stopped`、`failed`。结局:`ready`、`exited`(带 deliberate 标志)、`startup-timeout`、`spawn-failed`。

## 进程树

```text
Electron main process
`-- bundled Node (runtime-node-entry.mjs)
    `-- DSH CLI (lib/bin.js) serving the Web UI on 127.0.0.1:<port>
```

Windows 上强制关停用 `taskkill /T`,会连 DSH Node 进程的子进程一起终结。非 Windows 开发宿主上,强制关停向直接的 bundled Node 子进程发 `SIGKILL`。

## ts-pattern 使用策略

ts-pattern 的 pin 是为了可读性,不是为穷尽而穷尽:

- 多分支、嵌套结构或 discriminated-union 逻辑,当 `match` 比原生条件降低认知负担时使用。
- 封闭 union 用 `.exhaustive()`,让编译器证明每个分支都被处理。
- `.otherwise()` 只用于有意的开放或默认语义。
- 禁用 `.run()`;优先直接返回值的形态。
- 简单守卫、判空、一两个分支的条件保持原生写法。
- 不做对可用代码的机械改写。

## 权威来源

| 关注点 | 权威来源 |
| --- | --- |
| 身份与精确版本 | `package.json` 与 `package-lock.json` |
| 生命周期常量 | `src/shared/contracts.ts` |
| 安全策略 | `src/main/security-policy.ts` |
| Windows 冒烟流程 | `.github/workflows/windows-package.yml` |
| 发布流程 | `.github/workflows/release.yml` |
| 文档 | 仅描述,绝不权威 |
