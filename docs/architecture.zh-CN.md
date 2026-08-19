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
| `<userData>/tools` | 仅 Windows:每次启动重写的 `pnpm.cmd` 启动器 |

在 app ready 之前,非空的 `DSH_FLIGHTDECK_USER_DATA` 环境变量会覆盖该目录(`app.setPath("userData", ...)`)。打包态冒烟为每个阶段各设一个,使未打包执行与安装后执行绝不共享 `DSH_HOME`、日志或 junction;它同时服务于便携安装。

子进程以 `windowsHide: true`、piped stdio、`NO_COLOR=1` 启动,并从环境中移除 `ELECTRON_RUN_AS_NODE`。输出写入日志文件,并保留最近 200 行的有界环形缓冲。

## Vendored 依赖修复

`@deepseek-ai/dsh@0.1.0-rc.7` 在 Windows 上用 NTFS directory junction 维护 `$DSH_HOME/profiles/node_modules`。其 `ensureSymlink` 用 `lstatSync(...).isSymbolicLink()` 判定链接所有权、用 `unlinkSync` 删除链接;但 junction 被报告为目录(不是 symlink)且无法 unlink——于是安装位置移动后重新指向 fallback 时,子进程以 `uncaughtException` 崩溃。

`patches/@deepseek-ai+dsh-app-boot+0.1.0-rc.7.patch` 修复 `ensureSymlink`:通过 `readlinkSync` 识别 junction,带 NT 前缀容忍度做比较,并用 `rmdirSync` 删除(只删 reparse point,绝不删目标)。`postinstall` 脚本(`patch-package`)在每次干净安装时重放补丁;`test/profile-fallback.test.ts` 在 CI 平台上覆盖创建/幂等 heal/重指向/真目录拒绝四类用例。

## 打包运行时闭包

electron-builder 的生产依赖收集器只走 `dependencies` 边,因此仅能通过 DSH `peerDependencies` 到达的包(npm lock 里标记 `"peer": true` 的条目)会被静默丢出 `resources/app/node_modules`。未打包冒烟曾掩盖这一缺口:Node 从 `dist/win-unpacked` 沿父目录上溯会逃进仓库自身的 `node_modules`;安装在无关目录的副本做不到,DSH 在加载 `@deepseek-ai/dsh-app-boot` 时死于 `ERR_MODULE_NOT_FOUND`。

`@deepseek-ai/dsh@0.1.0-rc.7` 的完整 peer-only 闭包(19 个包)被声明为 `package.json` 的直接依赖;`windows-package.yml` 在每次冒烟前校验仓库 `node_modules/@deepseek-ai` 的每个包在 `win-unpacked` 与安装后两棵树里都存在——未来 DSH 升级若改变 peer 闭包,打包步骤会响亮地失败,而不是变成一个费解的 fatal 标记。

## Vendored web profile 种子

DSH 对缺失的 `web` profile 会用空依赖模板初始化,而 `dsh plugin` 是唯一受支持的安装器(需要目标机上的 pnpm + 网络)。桌面应用改为随包分发一个预置好的 profile:

- `scripts/prepare-profile-web.mjs` 在打包期暂存 `build/profile-web/payload`:profile manifest(模板 bundle `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`,加上四个经审核插件)、一份空的 `cordis.patch.yml`、DSH profile 自身的 `pnpm-workspace.yaml`(与 dsh-app-boot 的 `PROFILE_PNPM_WORKSPACE` 模板逐字节一致),以及 `dshmarket@1.14.1`、`dsh-find-plugin@0.3.7`、`dsh-anchored-subagent@0.3.0`、`dsh-better-sidebar@0.13.1` 的一棵无符号链接 npm 生产依赖树。`dsh-anchored-subagent` 仅发布在 GitHub:种子用 codeload tarball URL pin 到精确 commit,npm 在打包期解析,目标机永远不需要 git(`github:` 形式会让 pnpm 在 heal 路径上经 git 重新解析)。`dsh-better-sidebar` 的 `node-pty` 以 N-API prebuilds 覆盖 darwin/win32 的 x64+arm64,安装从不触发原生编译;打包工作流把 setup-node pin 到 `24.19.0`(vendored runtime 的版本),即使将来回退到源码编译也绝不会歪 ABI。`dsh-better-sidebar` 的 15 个 `@deepseek-ai` peer 全部从打包闭包解析(含 `@deepseek-ai/cordis@4.0.1`);其裸 `cordis` peer 仅是类型层引用(擦除的 `.d.ts` import)。插件 peer 依赖刻意不随包分发——运行时从打包的 DSH 闭包 heal 进 `$DSH_HOME/profiles/node_modules` 后解析。
- `pnpm-workspace.yaml` 是 load-bearing 的,不是摆设:其 `autoInstallPeers: false` 阻止 pnpm 默认的 peer 自动安装——否则它会把种子插件的 `@deepseek-ai` peer 范围解析进受限(私有) registry 的包,使每次 market 安装都以依赖不可解析而失败,即 `0.1.0-rc.4` 真机故障(`@deepseek-ai/dsh-type-meta`)。`dsh-find-plugin` pin 在 `0.3.7`,因为 `0.3.6` 的 peer 范围 `@deepseek-ai/dsh-tools@^0.0.1-rc.1` 只能解析到受限的 `0.0.1-rc.x`;`0.3.7` 把 peer 挪到了公开的 `^0.1.0-rc.6` 线。
- payload 在 extraResources 拷贝根下再嵌一层,是因为 electron-builder 会丢弃被拷目录根上的 `node_modules`(`0.1.0-rc.1` 的 CI 正是这样失败的:manifest 种下去了但插件树缺失,DSH 死于无法解析 `dshmarket` bundle)。`windows-package.yml` 与 `release.yml` 都在任何冒烟前断言打包后的 `resources/profile-web/payload` 树。
- electron-builder 通过 `extraResources` 把暂存树以 `resources/profile-web` 分发;主进程从 `resources/profile-web/payload` 播种。
- 仅首次启动(打包态)时,`src/main/profile-seed.ts` 把种子复制进 `<userData>/harness/profiles/web`,以目标 `package.json` 为键——已存在或被用户改过的 profile 绝不覆盖。
- 播种失败降级为 DSH 的空模板初始化,不会阻塞启动。
- 运行时不需要 pnpm,也不需要网络。插件版本冻结在 prepare 脚本里;改动需要重新构建。
- 之后从 market UI 继续安装插件,由下文的 vendored pnpm 启动器兜住,目标机依旧不需要 Node 工具链。第一次此类安装会把种子的 npm 扁平 `node_modules` 迁移成 pnpm 布局并重新解析两个种子插件;安装本就需要网络,故此代价被接受。

## Vendored 工具启动器(pnpm + dsh)

DSH market 在两处探测子进程 PATH,0.1.0-rc.2 真机已在第一处失败过:内置的 runtime node 不带 npm/corepack,宿主机 PATH 上也没有 Node 工具链。因此仅在 win32 上,启动时向 `<userData>/tools` 写入两个启动器(`src/main/tool-launchers.ts`),该目录被 harness 前置到子进程 PATH:

- pnpm —— market 通过探测 PATH 来置备 pnpm(`dshmarket@1.14.1` 的 `dsh-cli.js`:`corepack enable`,然后 `npm install -g pnpm`,每步以 `pnpm --version` 作为成功门——其 `spawnEnv` 保留继承的 PATH)。`pnpm@11.7.0` 是 `dependencies` 直接 pin(纯 JS 包无依赖,engines node >=22.13,由 vendored `node@24.19.0` 满足),electron-builder 的生产收集器像闭包其余部分一样把它装进 `resources/app/node_modules`。版本与用户实测 profile 的 `packageManager` 字段一致;`dataelement/dsh-desktop` 的 10.34.5 pin 是备选记录。启动器运行 `pnpm/bin/pnpm.cjs`。
- dsh —— market 插件安装会重新调用 DSH CLI,但 `dshArgv()` 只认匹配 `/[\\/](?:bin\.(?:js|ts)|dsh)$/` 的 `process.argv[1]`(`dsh-cli.js:126-141`);harness 入口 `runtime-node-entry.mjs` 不匹配,重调用便回退到 PATH 上的裸 `dsh`——正是 0.1.0-rc.3 真机故障(`'dsh' is not recognized as an internal or external command`)。启动器在 vendored node 下运行 vendored DSH 入口(`@deepseek-ai/dsh/lib/bin.js`,由 `runtime-paths` 解析为 `dshBin`)。
- 两个启动器都以 `@chcp 65001 >nul` 开头——否则工具诊断在中文 Windows 上会变成 GBK 乱码,也就是 market 日志里那条乱码版「不是内部或外部命令」——随后是 `runtime-paths` 解析出的 vendored `node.exe` 运行 vendored 入口。它们绝不使用 `process.execPath`(Electron 二进制)。两个文件每次启动都重写,升级安装不会留下过期的绝对路径。
- harness 子进程的 PATH 被前置了 `<userData>/tools`(`src/main/runtime.ts` 的 `buildHarnessSpawnOptions` + `withPrependedPath`;Windows 的 `Path`/`PATH` 大小写冲突被合并为单一键)。注入沿父 → DSH → dshmarket → pnpm/dsh 传递,因为 dshmarket 的 `spawnEnv` 与 `dsh plugin` 转发器都继承子进程 PATH。
- POSIX 平台不写启动器(产品只打包 Windows;开发态 macOS 机器自带工具链)。启动器写失败只记日志并继续——没有注入,绝不阻塞启动。

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
