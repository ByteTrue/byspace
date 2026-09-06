---
kind: issue
title: "Terminal 默认 shell 配置与自动探测"
type: feature
status: open
created: 2026-02-13
---

# Terminal 默认 shell 配置与自动探测

> **读者：** 跨会话接手的人。目标:在设置里增加一个选项,自动识别电脑上安装的 shell,并配置 terminal 默认使用的 shell。

## 做成以后是什么样

Host Settings 的 Terminals 页新增 "Default shell" section。用户看到 daemon 当前实际使用的默认 shell,可以在探测到的已安装 shell 列表中选择一个,或选 Auto(跟随系统)。选择保存后,新开的 terminal(客户端请求与 ACP 等所有创建路径)都使用该 shell;老 daemon 上该 section 隐藏。

**范围:** 包含 daemon 侧探测 util、daemon 配置字段 `daemon.terminalDefaultShell`、创建路径注入、detect RPC、app 设置 UI 与 i18n;不包含 per-workspace/per-tab shell 选择、terminal profiles 改动、已运行 PTY 的迁移。

**归属:** 独立 issue;相关真相 `codestable/spec/terminal.md`(输入与粘贴、快照恢复)、`docs/rpc-namespacing.md`、`docs/protocol-compatibility.md`。

## 为什么现在做 / 当前坏在哪

daemon 默认 shell 只看 `$SHELL` env 兜底 `/bin/sh`(Windows 为 `%ComSpec%`),daemon 以 launchd/服务方式启动时 `$SHELL` 常缺失,落到 `/bin/sh`;用户无法控制。macOS 登录 shell(zsh)实际存在,但 daemon 感知不到。

## 现状怎么工作

`createTerminal()`(`packages/server/src/terminal/terminal.ts`)在 `options.shell` 缺失时调 `resolveDefaultTerminalShell()`:`$SHELL || "/bin/sh"`,Windows 用 `env.ComSpec`。`CreateTerminalRequestSchema` 没有 `shell` 字段,客户端不能指定;配置里没有 shell 设置项。`daemon.terminalProfiles` 是启动某程序的 profile 列表(claude/codex 等),与默认 shell 无关。

## 动哪些、验哪些

- 必须改:
  - `packages/protocol/src/messages.ts`:`daemon.terminalDefaultShell` 配置字段、`terminal.shell.detect.request/response` schema、`server_info.features.terminalShellConfig` gate
  - `packages/server/src/terminal/shell-detect.ts`(新):`detectInstalledShells()` + 单测
  - `packages/server/src/server/bootstrap.ts`:terminalManager 包装层注入配置 shell
  - `packages/server/src/server/session.ts`:detect RPC handler
  - `packages/app/src/screens/settings/host-page.tsx`:DefaultShellSection
  - `packages/app/src/i18n/resources/*.ts` × 9
- 需要验:shell 优先级(request > 配置 > 自动探测)、探测去重与存在性过滤、老 client/daemon 兼容、保存后新建 terminal 生效
- 仍未知:Windows 探测质量(仅能在 CI 外手动验证)

## 方案与实现安排

**shell 优先级:** 请求显式 `command` > daemon 配置 `daemon.terminalDefaultShell` > `resolveDefaultTerminalShell()` 自动解析(`$SHELL`/ComSpec)。注入点在 bootstrap 处的 persisting terminalManager 包装层,所有创建路径统一覆盖,不改 `create_terminal_request` wire schema。

**探测(detectInstalledShells):**

- Unix:`$SHELL`、macOS `dscl . -read /Users/$USER UserShell`、`/etc/shells` 中实际存在的项、常见额外路径(`/opt/homebrew/bin/fish` 等),existsSync 过滤,按路径去重
- Windows:`pwsh.exe`(PATH)、`powershell.exe`(System32)、`cmd.exe`(ComSpec)、Git Bash(固定路径)
- 返回 `{ path, name }[]`,name 为 basename

**RPC:** `terminal.shell.detect.request`(仅 `requestId`)→ `terminal.shell.detect.response` `payload: { shells, resolvedDefault, error: null }`;按 `docs/rpc-namespacing.md` 点分命名。

**兼容:** `server_info.features.terminalShellConfig: true` 门控;老 daemon 上 app 隐藏 section。配置字段 optional,老客户端不认识不影响。保存无效路径不做写时校验,spawn 失败经既有 `create_terminal_response.error` 报错。

**App UI:** HostTerminalsPage 新增 section,置于 Terminal Profiles 之前:当前生效 shell 展示、Auto + 探测列表(含自定义路径输入,后续需要再加)、保存走 `patchConfig({ terminalDefaultShell })`。

**质量目标:** 可靠性——所有创建路径一致生效;可维护性——探测 util 可注入候选列表测试,不 mock fs。

## 验证

- `shell-detect.test.ts`:注入候选列表,断言去重、存在性过滤、macOS dscl 输出解析
- 注入优先级测试:request command > 配置 > 自动
- typecheck + lint + 相关 vitest 文件
- 手动:dev daemon + app,改配置后新建 terminal 确认 `$0`/prompt 变化;老 daemon(CI 矩阵)上 section 隐藏逻辑走 features gate 单测

## 执行记录

### 实现(2026-02-13)

**Protocol** (`packages/protocol/src/messages.ts`):

- `MutableDaemonConfigSchema` / `MutableDaemonConfigPatchSchema` 增 `terminalDefaultShell`(string, nullish;null = 清除回 auto)
- 新增 `TerminalShellDetectRequestSchema` / `DetectedShellSchema` / `TerminalShellDetectResponseSchema`(`payload: { shells, resolvedDefault, configured?, error, requestId }`),已注册进 Session in/out union,ws-outbound AOT 验证器重新生成
- `ServerInfoStatusPayloadSchema.features.terminalShellConfig` gate,COMPAT 标记 2027-09-01

**Server**:

- `terminal/shell-detect.ts`(新):`detectInstalledShells()` — Unix 顺序为 `$SHELL` env → macOS `dscl UserShell` → `/etc/shells` → 常见路径(bash/zsh/fish/nu,含 /opt/homebrew),Windows 为 pwsh/powershell/cmd(PATH 解析);绝对路径去重 + existsSync 过滤;探测失败降级不抛错。`shell-detect.test.ts` 8 个用例(候选注入,不 mock fs)
- 注入链:bootstrap `createConfiguredTerminalManager({ getDefaultShell })` → worker-terminal-manager(`options.shell ?? getDefaultShell()`)→ IPC `TerminalWorkerRequest.createTerminal.options.shell` → terminal-manager(`options.shell && !options.command` 时转发)→ `createTerminal`。所有创建路径统一覆盖
- detect RPC handler 挂 `TerminalSessionController`(dispatch + `handleShellDetectRequest`),读 `daemonConfigStore.get().terminalDefaultShell`;session.ts 接线;`operation-permissions` 注册 request/response 均为 `daemon.read`;websocket-server 广告 `terminalShellConfig: true`
- config 管道:persisted-config(persisted nullish)→ config.ts(resolve,null 转 undefined)→ bootstrap `PaseoDaemonConfig.terminalDefaultShell` → `applyOptionalConfigLists`(顺带把原 if 链收拢以过 complexity)
- daemon-config-store:`SupportedMutableConfigPatch.terminalDefaultShell` 允许 null;`mergeMutableDaemonPatch` 持久化 null

**Client**: `daemon-client.ts` 增 `detectTerminalShells()`(correlated request)+ `DetectTerminalShellsResult`

**App**:

- `screens/settings/default-shell-section.tsx`(新):SettingsSection + SelectField;Auto 选项(description 为当前 resolved default)+ 探测列表(name + path);保存走 `patchConfig({ terminalDefaultShell })`,null = Auto;features gate `terminalShellConfig`,未支持/未连接返回 null(隐藏)
- host-page `HostTerminalsPage` 在 Terminal agents 与 Terminal Profiles 之间挂入
- i18n `terminalDefaultShell` 块 × 9 语言(en/zh-CN/ja/ko/ru/pt-BR 翻译,fr/es/ar 与自身 terminalProfiles 一致保持英文)

与设计偏差:无实质偏差。persisted/config/mutable 三层都允许 null(设计只说 optional),用于客户端 "Auto" 清除;`createInitialMutableDaemonConfig` 抽出 `applyOptionalConfigLists` 以过 complexity lint。

### 验证(2026-02-13)

- `npx vitest run shell-detect.test.ts` — 8/8 通过(去重、存在性过滤、dscl 解析、dscl 失败降级、非绝对 SHELL 忽略、Windows PATH 解析)
- `npx vitest run worker-terminal-manager.test.ts` — 26/26 通过,含 2 个新用例(配置 shell 透传 IPC;显式 shell 优先、未配置时省略)
- `npx vitest run terminal-session-controller.test.ts` — 21/21,含 2 个新用例(detect 响应组装含 configured;探测失败返回 error 而非抛出)
- `npx vitest run daemon-config-store.test.ts` — 36/36,含新用例(set shell 持久化;null patch 清除后 persisted 为 null)
- typecheck:protocol / client / server / app 全部通过
- lint:0 warnings 0 errors;format:oxfmt 已跑

### 已知限制

- Windows 探测质量仅能在 Windows 机器上人工验证(CI 是 Linux);候选路径为 pwsh/powershell/cmd,未含 Git Bash
- 自定义 shell 路径输入未做(探测列表 + Auto 覆盖主场景)
- 老 daemon(无 gate)上 section 隐藏;新 daemon 不会收到老客户端的 detect 请求或 shell patch,无兼容风险

## 关闭时

- 回写候选:`codestable/spec/terminal.md` 增补默认 shell 配置小节
- 遗留:Windows 探测仅 CI 外验证;自定义路径输入未做
