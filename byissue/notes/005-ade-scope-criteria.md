# 005：ADE 的能力边界判据——不要成为用户本来会去调用的那个东西

> **读者：** 评估一个新能力该不该进 BySpace 的人，或刚看完一份「功能很全」的竞品功能清单的人。先看结论，再看细节里的样例证据。
> **自检：** 一句话判据 · 触发场景 · 六条否决 · 症状判据 · 样例证据 · 相关 issue/spec。
> 同主题改原文件，不另开第二条。

---

**结论：** 一条能力该不该进 ADE，先问它是不是在**替换用户本来就会去调用的那个东西**。如果是，不进——不管它做得多好。BySpace 的立场是 daemon 暴露领域、web 是唯一入场口、结构化会话与 terminal 两条平级路径、provider 是适配器；**工作流活在用户自己的 agent 配置里，daemon 不持有它**。

**何时用：** 评估新能力范围时；评审竞品功能清单时；有人提「别人都有这个」时。

**细节：**

## 判据的来源：2026-09-30 的六条否决

逐条看完 VelaTerm（一个功能面很宽的桌面 ADE）后，Owner 连续否决六项，形状完全相同：

| 候选                | 它替换了什么                                                    |
| ------------------- | --------------------------------------------------------------- |
| 终端输入补全        | shell 自己的补全器（oh-my-zsh / pwsh7 已有）                    |
| 更多 agent 状态档位 | 无。状态只回答「是否需要关注」，多加档位不增加信息              |
| Plan/Execute 工作流 | 用户自己的工作流（已有 bi；多数人的工作流是第三方或自己沉淀的） |
| code graph          | 用户的搜索工具                                                  |
| code audit          | CI / 安全工具                                                   |
| 内建浏览器          | 浏览器（BySpace 是 web 端）                                     |

同一条判据也否决了「跨 workspace 统一编排入口」：编排要成立，宿主必须持有用户的流程状态——谁在等什么、哪些跟进已经发出、重启后从哪儿接着数。这与「daemon 不持有工作流」直接冲突。见 [026-d](../issues/026-d-cross-workspace-orchestrator.md)。

## 症状判据：不需要先有功能清单

出现以下任何一样，就该停下来删，而不是继续加：

1. **同一件事有两个以上实现。**
2. **需要靠测试或约定来维持两处一致。**
3. **把外部工具包成自己的能力。**

## 样例证据：VelaTerm 的病是「没删过东西」，不是「功能多」

以下全部来自源码核对（clone 于 2026-09-30，73 commits，首个 commit 是 2026-08-11 的公开释出）：

- **同一身份四张表。** `SessionKind` 枚举之外，`install.rs` 用 `&str` agent 键、`permission_catalog.rs` 的 `kind(agent: &str)`、`model_catalog.rs` 的 `match agent` 各自再实现一遍字符串→枚举映射，靠每文件一个测试钉住（`install.rs:579` 的注释写着「Binary names must match inject.rs」）。
- **`SessionKind::` 出现在 51 个文件、约 1040 处。** 加一个 provider 的落点在 14–20 个文件。
- **三个并行的状态权威。** agent hook、`Busy` 迟滞 200ms 轮询、前端 `screenDetect.ts` 屏幕识别同时在场，外加逃生口 `localStorage.vlx-arbitration = "frontend"`（`src/store/termStore.ts:1597`），注释自认这是「这块最危险的改动」。
- **通用状态事件不可信。** `src-tauri/src/agent/server.rs:1911-1921` 的 `working` / `asking` / `waiting` 全部 `authoritative: false`，只有带命名空间的 `codex_*` 事件是 `true`（`:1928`）；注释写明前者要防着「screen/busy heuristics 覆盖 Stop」。
- **model / effort 靠刮别的东西。** `session_settings.rs:335` 对 Claude 匹配字面串 `"Set effort level to "`；`:255` 对 Codex 读 `~/.codex/state_*.sqlite` 的 `SELECT model, reasoning_effort FROM threads`。
- **全局互斥。** `plan_execute.rs:124` 的 `operation_lock()` 是一个 `static Mutex<()>`，串行化所有工作流动作与每一次会话间消息投递。
- **两份清单基数不同、无交叉校验。** `spawn_cli.rs` 的技能表 9 条、shim 表 11 条：`vask` 有技能无 shim，`vrun` / `vflow` / `vself` / `vspawn-tree` 有 shim 无技能。
- **DDL 里粘进重复的建表语句。** `db/schema.rs` 的 `chat_codex_settings` 在 `:169` 和 `:227` 各出现一次。
- **文档默认与 wire 默认反向。** `skills/vspawn/SKILL.md:5` 写着默认不开 worktree、CLI 也显式发 `false`，但 `server.rs:39` 的注释是「the backend defaults to true」。
- **两个无人管的悬挂。** `pty/completion/mod.rs:45` 的 `requested: Option<(u64, Instant)>` 存了时间戳，`manager.rs:1498` 却只检查 `is_some()`、没有超时——shell 不回结束消息就永久卡住该 PTY 直到重启；`owner` 在客户端断开时不清理（全仓只在 `manager.rs:1679` 一处置 `None`）。

这十项没有一项是「功能多」的后果，全部是「加东西时不删旧的」的后果。

**相关：** [026-d 跨 workspace 的统一编排入口（已放弃）](../issues/026-d-cross-workspace-orchestrator.md) · [note 001 死代码审计的判据与陷阱](001-dead-code-audit-criteria-and-traps.md) · [byissue/vision/index.md](../vision/index.md)
