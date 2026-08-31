# 保留需求后续入口索引

本索引只为 Owner 已确认保留的 34 个原子需求建立最小后续入口，不恢复旧代码，也不创建同时处于执行状态的子任务。实际开始某一入口时，再按对应 skill 建立临时 work 游标、复现/验收并设计当前 `main` 上的最小实现。

## Terminal

| 入口                                             | Skill      | 需求 ID                 | 交付边界                                                                                                    |
| ------------------------------------------------ | ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| TERM-01 · Direct/Relay 性能与 Windows 停顿       | `cs-issue` | T01、T02、T08、T09、T16 | 先建立可重复分段基线，再定位并修复 Direct、Relay、Windows 逐键与组合 workload 的当前瓶颈。                  |
| TERM-02 · Retained renderer 与 revision resume   | `cs-issue` | T03、T04、T05           | 恢复切换首帧布局、renderer 保留和按 revision 缺口续传，不退回固定 200 行重放。                              |
| TERM-03 · 通知输出摘要                           | `cs-issue` | T06                     | 实机验收最近非空输出摘要；失败时用当前通知链路修复。                                                        |
| TERM-04 · Compact Web 选择与复制                 | `cs-feat`  | T07                     | 恢复长按选词、拖动选区和复制，不破坏滚动、点击输入与面板手势。                                              |
| TERM-05 · Bracketed paste 恢复与 ConPTY fallback | `cs-issue` | T10、T12                | 证明 attach/restore 后 DECSET 2004 正确；Windows 丢失 mode 时仍对多行输入强制 framing。                     |
| TERM-06 · Terminal 剪贴板图片粘贴                | `cs-feat`  | T11                     | 通过既有 binary upload 写入 daemon 临时文件，把真实远端路径作为单个 paste block 交给 Pi。                   |
| TERM-07 · Terminal agent activity 与 Pi          | `cs-feat`  | T13、T14、T17           | 保持 provider 独立 hooks，恢复 Pi extension/profile，并保证状态请求串行、有界合并、latest-wins 与失败续传。 |
| TERM-08 · 呈现默认值与 profile 入口              | `cs-issue` | T15、T18                | 验收字体、字号、高亮、主题默认值以及 Manage Terminal Profiles 的当前 Host 精确导航；只修复不满足项。        |

## Relay 与配对

| 入口                                        | Skill      | 需求 ID | 交付边界                                                                                                    |
| ------------------------------------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| RELAY-01 · Pairing offer hostname           | `cs-feat`  | R02     | Offer 携带 hostname，扫码新增 Host 默认使用可读名称。                                                       |
| RELAY-02 · Hosted HTTPS 阻断明文明网 Direct | `cs-issue` | R03     | 在发起 WebSocket 前拒绝 Hosted HTTPS→明文非 loopback Direct，同时保留 loopback、TLS 与 daemon 同源 Web UI。 |

## Agent 与 Timeline

| 入口                                          | Skill      | 需求 ID       | 交付边界                                                                                                                 |
| --------------------------------------------- | ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| AGENT-01 · Agent 引导项目准备                 | `cs-feat`  | A04           | 检查干净 worktree 可重复准备与并行开发，仅在用户确认后修改脚本和 `byspace.json` 并验证。                                 |
| AGENT-02 · 手动 Session ID 导入               | `cs-feat`  | A05           | Import Session 支持选择 provider 并输入 session/thread ID，精确导入目标主会话。                                          |
| AGENT-03 · Timeline 恢复、仲裁与同步状态      | `cs-issue` | A06、A07、A08 | 统一 Host timeline owner；覆盖 focus catch-up、并发顺序、gap/分页/rewind，并在远程恢复时保留旧 timeline 和显示同步状态。 |
| AGENT-04 · 使用当前 Agent 精炼 Workspace 名称 | `cs-feat`  | A09           | 保留首条 prompt 初始命名，并允许拥有完整上下文的当前 Agent 精炼 workspace/branch 名。                                    |

## Workspace 与侧栏

| 入口                                         | Skill      | 需求 ID           | 交付边界                                                                                                   |
| -------------------------------------------- | ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| WORKSPACE-01 · 分支来源标识                  | `cs-feat`  | W01               | BranchSwitcher 区分 Local、Remote、Both，并使用可辨识图标。                                                |
| WORKSPACE-02 · 手机 Workspace 菜单可见性     | `cs-issue` | W02               | 实机验收 compact/native 始终显示三点菜单；只修复失败平台。                                                 |
| WORKSPACE-03 · 已推送分支的 Push 状态        | `cs-issue` | W04               | 验收无 upstream 但 origin 同名已同步时刷新后不显示 Push。                                                  |
| WORKSPACE-04 · Hover 展示全部 Agent 精确状态 | `cs-feat`  | W05（仅此子目标） | Hover card 展示该 Workspace 下全部 Agent 的精确状态；不改 Project/Status 分组，不增加 attention 优先排序。 |
| WORKSPACE-05 · Project 级 Auto Host Badge    | `cs-feat`  | W14               | 同一 Project 跨至少两台 Host 才显示设备名，单 Host Project 隐藏。                                          |

## Compact UI

| 入口                           | Skill     | 需求 ID  | 交付边界                                                                                          |
| ------------------------------ | --------- | -------- | ------------------------------------------------------------------------------------------------- |
| UI-01 · Compact Agent controls | `cs-feat` | U03、U05 | 弱化消息区悬浮控件，将 compact context 用量并入 composer，并把折叠工具/回到底部放入 pane header。 |

## Hosted release channel

| 入口                                       | Skill     | 需求 ID | 交付边界                                                                                                                                                                       |
| ------------------------------------------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RELEASE-01 · Stable/Beta App 与 Relay 路由 | `cs-feat` | B01     | 保留根域与双 App/Relay 基础设施，恢复 prerelease 自动选择 `app-beta.byspace.cc.cd` 和 `relay-beta.byspace.cc.cd:443`；stable 继续使用 stable tuple，自定义 endpoint 始终优先。 |

## 覆盖校验

- 保留原子 ID：34 / 34，且每个只映射一次。
- 后续入口：21 个。
- 不做条目与 O01–O05 不创建后续入口。
- 本索引不代表实施顺序、实现授权、commit 授权或远端发布授权。
