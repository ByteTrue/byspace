# 手动填 ID 导入 talk

## 原始想法

用户会用命令行直接跑 agent（例如装了 pi-subagents 扩展的 Pi）。想把这类 CLI 会话转成 BySpace 托管 agent 时：

- UI 路径：点击 Import → 只能从"最近会话"自动扫描列表里选。用 Pi + subagent 扩展时，列表被大量 subagent 子会话淹没，找不到真正想导的主会话。
- CLI 路径：`byspace agent import <id> --provider <p> [--cwd <path>]` 能按 ID 精确导入，但每次要手输完整命令、记 session id、还要在正确目录下执行（等价于指定 cwd/workspace），很麻烦。

诉求：把 CLI 这种"按 ID 精确导入"的能力搬到 UI 上。

## 真问题

两个独立问题，根因和处理方式都不同：

1. Pi + subagent 扩展场景下，"最近会话"自动扫描列表混入大量 subagent 子会话，噪声掩盖了目标会话。
2. UI 的 Import Session sheet 完全没有"手动填 provider + session ID"的入口，只能依赖自动扫描列表；CLI 这种确定性导入方式在 UI 里没有等价物。

## 术语

- **Import**：把一个 provider 原生会话转换成 BySpace 托管 agent 的动作，UI（Import Session sheet）和 CLI（`byspace agent import`）都有入口。
- **最近会话列表**：Import Session sheet 里按 provider 自动扫描出的可导入候选（`fetchRecentProviderSessions` / `listImportableSessions`）。
- **root/主会话**：用户真正发起的 Pi 会话，存储在 `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl`（Pi 官方文档承诺的扁平布局）。
- **subagent 子会话 transcript**：pi-subagents 这类扩展派生出的子任务会话，落盘位置和格式是扩展自己决定的，不受 Pi 核心保证。
- **ambient cwd**：Import Session sheet 从调用方拿到的、已知的当前工作区目录（例如从 Workspace 内打开时）。

## 已确认决策

- **问题 1（自动扫描列表混入 subagent 噪声）：不做。**
  - AI 最初提案：收紧 Pi 的 session scanner，只扫两层目录（`sessionsDir → cwd 目录 → *.jsonl`），不再递归进子目录，从而把 pi-subagents 现在这种嵌套存储的子会话排除掉。
  - 用户否决理由：pi 原生没有 subagent 概念，当前观察到的嵌套存储格式（`<父session>/<childId>/run-N/session.jsonl` 或 `<父session>/tasks/*.jsonl`）只是用户装的这一个第三方扩展的实现细节，不是 Pi 或 BySpace 能依赖的稳定契约。其它 subagent 类扩展完全可能用不同的落盘方式（包括和主会话同级平铺、单纯靠文件名区分等），届时"只扫两层"这类过滤规则不但无效，还可能误伤真会话。而 Pi 会话 JSONL 本身（header 和正文）不带任何 `parentSessionId` / `isSubagent` 标记，BySpace 没有通用、面向未来的信号可以依赖。
  - 结论：这是装了特定扩展后的个人 workaround 范畴，不作为 BySpace 功能改动追踪；用户在自己环境里可以手动清理或规避。
- **问题 2（UI 手动导入入口）：做。**
  - 范围收窄：只覆盖「已经添加了 workspace、cwd 已知」的场景（即 `workspace-screen.tsx` 已经把 `cwd={workspaceDirectory}` 传给 Import Session sheet 的入口）。手动导入模式下 cwd 直接复用 ambient workspace 目录，不需要用户输入。
  - 明确排除：不做"手填目录路径"的输入框/自动补全（复用 add-project-flow 目录搜索控件的方案作废）。全局 Home 首页的 Import 入口（`open-project-screen.tsx`，无 ambient cwd）本轮不改。
  - 理由：手输路径在任何场景下都是差体验；限定在已知 cwd 的入口，可以完全不做路径输入，同时覆盖用户真实工作流的主要场景——已经在某个 workspace 里工作，想把之前用 CLI 跑的会话拉进来。

## 约束

- 后端协议 / provider 层已经是 provider-agnostic 的：`importAgent` 只需要 `providerId` + `providerHandleId`（= session/thread id）+ `cwd`（必填），`workspaceId` 可选（由 cwd 自动 find-or-create，不需要单独指定）。不需要为不同 provider 定制字段。
- 手动填的 session ID 不经过扫描器校验，合法性完全依赖后端 `importAgent` 的报错（会话不存在 / provider 不匹配 / 已被导入等），UI 只需要把已有的错误信息透出，不做额外的格式校验。

## 影响面、风险与取舍

- 改动集中在 `packages/app/src/components/import-session-sheet.tsx`（新增"手动输入"模式）及其在 `workspace-screen.tsx` 的调用点；`open-project-screen.tsx` 调用点不变。
- 不涉及协议新增字段（`importAgent`/`ImportAgentRequestMessage` 已支持所需参数），风险主要在前端表单状态与错误态展示。
- 取舍：牺牲了"哪里都能手动导入"的完整性，换取零路径输入、零新增控件的简单版本；后续如果全局入口也要支持，需要用户重新决定要不要做路径输入或工作区选择器。

## UI 对齐草图

- 角色与入口：Workspace 内点击 Import → 弹出的 Import Session sheet 顶部增加模式切换（"最近会话" / "手动输入"，示意）。
- 图示状态：目标

```text
┌ Import Session ──────────────────────┐
│ [最近会话] [手动输入]      ↻          │
├───────────────────────────────────────┤
│ Provider   [ pi        ▾]             │
│ Session/Thread ID [__________________]│
│ (cwd = 当前 workspace 目录，不展示/只读)│
│                                        │
│              [ 取消 ]  [ 导入 ]        │
└────────────────────────────────────────┘
```

- 已确认关系：手动模式复用现有 sheet 的 header/关闭/成功回调；provider 选择复用现有 filter combobox 的选项来源；提交调用现有 `importAgent`。
- 仍待确认：模式切换的具体交互位置和文案（做实现时按现有组件风格定，不升级为需要用户确认的决策点）。

## 候选质量目标

- 易用性：手动输入模式下，会话不存在 / 已被导入 / provider 不匹配等错误要有清晰独立的提示，不能只显示通用失败文案。
- 不做的：不对 session ID 做格式预校验（YAGNI，交给后端报错）。

## 分歧

（无，范围已收敛）

## 初步出口草案

- 建议出口：独立 issue（常规，`type: feature`），因为涉及新 UI 状态（模式切换、手动表单、错误态）和一个调用点改造，不是一次性小改。
- 候选事项：Import Session sheet 增加"手动输入 provider + session ID"模式，仅在 ambient cwd 已知（workspace 内）时可用；provider 选择复用现有 combobox；不做路径输入；全局 Home 入口不变。
- 暂不纳入：全局 Home 导入入口的手动模式、任意路径输入/目录选择器、跨 workspace 的 workspace 选择器——留待以后用户需要时再提。
