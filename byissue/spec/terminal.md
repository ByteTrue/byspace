# Terminal

BySpace Terminal 同时支持实时输出、历史回放、断线恢复和 daemon 重启后的标签恢复。用户在这些路径中看到的字符、颜色、换行和先后顺序必须一致；恢复不能改变原始命令输出。

## 快照与恢复

Daemon 从当前 xterm buffer 生成 scrollback 和 visible grid。两部分使用同一套 cell 提取规则，并按从旧到新的顺序交给客户端。客户端把快照恢复为 ANSI 后再进入普通 Terminal 渲染链路，不维护第二份文本模型。

双宽字符占用一个有字符的 cell 和一个 `width=0` 结构占位格。占位格不能序列化为普通空格，否则中文等字符在每次回放后都会把后续内容右移。新快照用空字符表达该占位并在 ANSI 渲染时跳过；旧 daemon 已发送的普通空格仍按原字节显示。

Alternate buffer、current grid 和 scrollback 都遵守同一 active-buffer 规则。行截断、wrapped 标记和 scrollback 上限必须保持一一对应。

## 尺寸同步与首帧就绪

- 终端组件挂载时只在 WebGL 换装完成且测量出非零有效 fit 后才声明 `onRendererReady`；在就绪前不发起数据流订阅，确保首次发送的 `restore.size` 100% 为最终满宽几何，避免远程 PTY 收到未测量的初始尺寸导致会话被多次重新刷新（Resize Storm）。
- 挂载阶梯与布局过渡等被动尺寸变化统一通过 250ms 尾部合并窗口发送，用户交互驱动的尺寸变化保持即时发送。

## 外部链接与超链接

- Terminal 运行时同时加载 `WebLinksAddon`（纯文本 URL 正则识别）与显式 `linkHandler`（OSC 8 ANSI 富文本超链接）。
- 终端中点击任意外部链接直接统一路由至应用级 `onOpenExternalUrl` 链路，禁止触发 xterm 原生危险确认弹窗，桌面端交由系统默认浏览器打开。

## Revision 恢复与历史上限

- 同一 renderer 的恢复按 revision 补缺口，正常恢复保留客户端 10,000 行 scrollback；缺口不可恢复或必须新建 renderer 时回退权威 snapshot，最多携带 1,000 行，不做固定行数重放。
- 断线恢复与 resize 序列不得产生字符丢失、乱序或额外 snapshot。

## 输入与粘贴

- attach、restore 和隐藏返回后重新确认 DECSET 2004 bracketed paste 状态；逐键输入路径不因粘贴恢复而改变。
- Windows ConPTY 未透传 mode 2004 时，多行剪贴板文本仍作为一个 bracketed paste block 发送给 PTY，不退化为逐行裸粘贴。
- 剪贴板中的图片经既有 binary upload 写入 daemon 临时文件，Terminal/Pi 收到真实远端路径；客户端本地路径不发给远端 Agent。

## 通知与选择

- Terminal 完成通知优先使用最近一段非空输出摘要；空白尾行和无输出时保持稳定内容，不扩大既有通知数据边界。
- Compact Web 支持长按选词、拖动扩展与复制；滚动、点击输入和面板手势保持原语义。
- Agent 活动上报按 provider 独立配置：Claude、Codex、OpenCode 与 Pi extension 各自开关，请求串行、有界合并、latest-wins；历史 global 开启只继承给 Claude/Codex/OpenCode，Pi 必须用户显式启用。
- Manage Terminal Profiles 精确打开所选 Host 的 Terminals 设置页。

## 重启恢复

- Daemon 重启（崩溃拉起、自动更新、停机、睡眠导致的 daemon 死亡）后，workspace 的 terminal 标签按原 id、名称和 cwd 恢复为全新 shell。运行中的进程和 scrollback 不恢复：PTY 与 daemon 同生共死，这是与 Agent 对话恢复的关键差异。客户端布局里持久化的 terminalId 因此跨重启仍然有效。
- 只有标签元数据被持久化（id、cwd、workspaceId、名称、profile 命令）。恢复时丢弃 cwd 已删除或 workspace 已归档/不存在的记录，并回写幸存集合；存储文件损坏只记日志并跳过恢复，不阻塞启动。
- 恢复在 daemon 开始监听前完成，客户端连上时看到的列表已是最终状态。持久化写失败只记日志，不影响终端生命周期。
- 优雅停机是保留语义：停机时的 killAll 不从持久化中移除记录，下次启动据此恢复；只有有机移除（用户关 tab、shell 自退、workspace 归档）才会删记录。命令在 create 完成前就退出的终端不落盘。

## 默认 shell

- 新终端的 shell 按优先级解析：请求显式 `command`（profile 启动）> daemon 配置 `daemon.terminalDefaultShell` > 自动解析（`$SHELL`，Windows `%ComSpec%`，兑底 `/bin/sh`）。配置缺省或为 null 即 Auto，即合并前的行为。
- 注入点在 bootstrap 处的 terminalManager 包装层，请求显式 shell 时才透传；所有创建路径（客户端请求、ACP、重启恢复）统一生效，profile 启动（带 `command`）不受影响。
- 探测（`terminal.shell.detect` RPC，权限 `daemon.read`）按 `$SHELL` → macOS `dscl` 登录 shell（2s 超时，域控挂起时降级）→ `/etc/shells` → 常见路径的顺序发现，existsSync 过滤后去重；Windows 为 `ComSpec` + pwsh/powershell/cmd 按 PATHEXT 后缀解析。任一来源失败降级继续，探测失败经 response `error` 返回，不抛出。
- 设置 UI（Host → Terminals → Default shell）由 `server_info.features.terminalShellConfig` 门控；老 daemon 上隐藏。Auto 选项保存为 null patch，持久化为 null，读侧转回 auto。保存不做路径校验，无效路径在 spawn 时经 `create_terminal_response.error` 报错。

## Shell integration 与命令结束

- OSC 633 由 shell integration 发出。`D;<exitCode>` 同时是两个功能的唯一来源：workspace script 中非 service 那一类的结束判定（`worktree-bootstrap.ts` 的 `onCommandFinished`），以及「agent 被 SIGKILL／崩溃、没来得及上报 idle」时清掉终端的 `working`。两者都不能只靠 `onExit`：shell 回到提示符并不退出。
- 覆盖两个 shell：
  - zsh：`ZDOTDIR` 包装，加载 `shell-integration/zsh`。
  - PowerShell（pwsh / Windows PowerShell）：`-NoExit -Command` 点源 `shell-integration/pwsh/byspace-integration.ps1`。PowerShell 没有开机文件环境变量，只能走启动参数；`-Command` 在用户 profile 之后执行，因此包裹的是 profile 装好的 `Prompt`，用户自定义提示符和它自己的 `$?` 逻辑都保留。加载包 `try/catch`：Windows PowerShell 5.1 默认 `ExecutionPolicy Restricted`，点源任何 `.ps1` 都会抛，吞掉错误保证 shell 可用（VS Code 同样处理）。
- 判定 shell 用可执行文件 basename（大小写不敏感、同时切 `/` 与 `\`），因此 `pwsh`、`pwsh.exe`、绝对路径，以及 Windows 路径在 POSIX 宿主上的测试都能命中。
- 两个 shell 都先把资源拷进进程私有临时目录再加载，因此 `app.asar` 这类可直接导入但不可读的打包路径也能工作。

### PowerShell 首条命令走 env handoff，不敲键盘

- PSReadLine 渲染提示符**早于**它开始读输入；落在两者之间的字节由 cooked-mode 行律回显、其 Enter 被吃掉，命令只停在编辑缓冲里永远不执行（实测注入率随负载在 0–60% 波动；zsh 同窗口极窄未观测到）。所以 PowerShell 的首条命令（workspace script、worktree 终端命令）不能靠「首输出就绪」后敲入。
- 改为 spawn 时经 `BYSPACE_TERMINAL_SPAWN_COMMAND` 环境变量交给集成脚本；集成脚本在第一次 readline 把它作为返回值交给 host 执行 —— 与手打完全同路径：进历史、`$?` 真实、`D;<code>` 真实。消费后立即清掉该环境变量。
- `getShellSpawnCommandMode()` 向调用方暴露能力：`env-handoff`（本次 spawn 已移交，禁止再敲，会执行两次）或 `typed`（调用方照旧等就绪后敲入）。复用的旧终端（plain script 重跑）一律 typed。zsh、cmd.exe 与所有未集成 shell 均为 typed，行为不变。
- 已经带显式 args 的启动（profile 命令 / `.cmd` shim 的 cmd.exe 命令行）不注入集成。
- PowerShell 只暴露成功/失败两态，`D` 报 `0`/`1` 而不是被调命令的真实退出码：`$LASTEXITCODE` 属于上一个 native 命令，cmdlet 失败时它是过期值。
- 未覆盖 bash、fish 与 cmd.exe（cmd.exe 没有 preexec 等价钩子）。这些 shell 里的 plain script 不会自动结算，只有终端进程真的退出时才走 `onExit`；agent 被强杀时终端圆点也不会自动清掉。

## 边界

- 字体、字号、主题和语法高亮属于 Appearance，不由快照恢复逻辑调整。
- Native renderer 可以用精确 cell 几何绘制 block 或 box glyph，但复制、选择和快照仍保留原 Unicode。
- Terminal 管线的背压、revision resume 和输出预算约束见 `docs/terminal-performance.md`。

## 历史证据

- [修复非 zsh shell 下 plain script 永远显示运行中](../issues/055-x-ff-powershell-shell-integration-command-finished.md)
- [Terminal 中文快照回放间距](../issues/001-x-terminal-cjk-snapshot-spacing.md)
- [Daemon 重启后 terminal 标签恢复](../issues/012-x-terminal-tab-persistence-across-daemon-restart.md)
- [Terminal 默认 shell 配置与自动探测](../issues/013-x-terminal-default-shell-config.md)
- [复原 Terminal 首帧 post-WebGL 尺寸就绪与 250ms 被动合并机制](../issues/005-x-terminal-remote-resize-storm-and-fit.md)
- [修复 Windows 下思考加载图标定格与终端 OSC 8 链接打开无反应](../issues/008-x-ff-synced-loader-and-terminal-osc8-links.md)
- [Epic 002 交付记录](../epics/002-x-retained-capabilities-delivery/spec.md)
