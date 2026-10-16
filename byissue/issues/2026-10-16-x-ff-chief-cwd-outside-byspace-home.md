---
kind: issue
title: "Chief 的 Home workspace 从 ~/.byspace 移到 ~/.byspace/chief"
type: ff
created: 2026-10-16
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# Chief 的 Home workspace 从 ~/.byspace 移到 ~/.byspace/chief

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

先查了 Multica 的做法：它不给「角色」分配工作目录，每个 run 的 cwd 都是现造的隔离 env root（`~/multica_workspaces/<workspace>/<task>/workdir`，`execenv.PredictRootDir`），默认根与它自己的状态根 `~/.multica` 是两个根；Mika（Chief of Staff）没有任何目录特权，聊天轮跑在与别人一样的临时 workdir 里，提示词反而禁止在聊天轮里 checkout 仓库。真正的分野是「agent 的 cwd 永远不是产品自己的状态目录」——这条我们没做到：Home workspace 的 cwd 就是 `~/.byspace` 本身，也就是 daemon 的 config.json、agents/、projects/、schedules/、uploads/ 和全部 worktree 所在处。

按同一分野把 Home 的 cwd 移到 `$BYSPACE_HOME/chief`。只消除「cwd 就是状态根」，不新开顶层根目录，沿用 BySpace 既有的「工作产物都在 `~/.byspace` 下」约定（`worktrees/` 就在那儿）。

- 改动：`packages/server/src/server/home-workspace.ts` — `HOME_WORKSPACE_DIR_NAME`/`resolveHomeWorkspaceCwd`；确保 cwd 存在；新增 `applyHomeCwd`：cwd 落在旧 daemon 发布路径（`~/.byspace` 本身，即状态根）上的 Home 记录在启动时就地改 cwd 与 displayName，独占 project 的 rootPath / displayName / projectKey 一起改，用户自己另外放的路径与共享 project 不动；`serverId` 传入以重算 projectKey。
- 改动：`packages/server/src/server/bootstrap.ts` — 传 `serverId`。
- 改动：`packages/server/src/server/agent/agent-roles.ts` — Chief 提示词改为「工作目录是 BySpace home 下的 `chief`；周围的 home 是 daemon 自己的状态，别在那里写、移动或删除」。
- 改动：`packages/server/src/server/home-workspace.test.ts` — 首建断言新 cwd 且目录真的建出来；新增旧 cwd 迁移、共享 project 不被拖动、用户自选 cwd 不被改三类用例。
- 验证：`npx vitest run packages/server/src/server/home-workspace.test.ts --bail=1`（16 passed）；`npm run typecheck`、`npm run lint`、`npm run format:check` 全绿。**未在真实 daemon 上验证迁移**：没有启动过本机 daemon（规则禁止），迁移证据是单测。

**决定用原地改记录、不是新建一条：** cwd 是放置、不是身份，但 workspace 的身份是 id——agent 记的是 workspaceId，新建一条会让现有 Chief 会话与 workspace 脱钩、在界面上凭空消失。原地改的代价是已存在的 Chief 会话仍跑在旧 cwd（agent 的 cwd 创建时固定），新建会话才落到新目录。这比丢会话小。

## 对 `byissue/` 的影响

已同步 `byissue/spec/agent-conversation.md`（Chief 段补 Home 的 cwd 与迁移规则）。Epic 005 spec 与 talk 007 里写的 cwd 已过期：`byissue/epics/005-x-chief-floating-assistant/spec.md`（第 23、27、44 行三处「`~/.byspace`」）与 `byissue/talks/007-chief-floating-assistant.md`（同义表述）。**已裁决（2026-10-16）：不回改**——Epic 005 已关闭，是历史记录，把现状回写进去等于改写关闭过的记录。

顺手发现（不在本次范围）：`list_agents` 工具不传 cwd 时按调用者 cwd 前缀过滤（`byspace-tools.ts`），Chief 从新 cwd `~/.byspace/chief` 出发仍然只看得见自己；跨 workspace 观察要靠显式传 cwd 或 CLI `byspace ls -a -g`。属独立一刀。
