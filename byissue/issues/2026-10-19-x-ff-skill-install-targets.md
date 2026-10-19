---
kind: issue
title: "编排 skills 可按安装位置选择：~/.agents 与 ~/.claude 各自开关"
type: ff
created: 2026-10-19
---

# 编排 skills 可按安装位置选择

`Choose skills` sheet 里只有「哪些 skill」，没有「装到哪」。选择结果永远同构写进
`~/.agents/skills` 和 `~/.claude/skills` 两个 home，只用 Codex/Pi 的人也会得到一份
Claude 目录，只用 Claude Code 的人也会得到一份共享目录。这个能力曾在 CodeStable 需求
A02 里被登记（`byissue/issues/046-x-selective-orchestration-skills.md`），triage 判为「不做」
后实现也随之消失，协议里从来没有 target 维度。

本次把「装到哪」加回来，作为 installation 的一半，与「装哪些」并列：

1. **协议新增 `AgentSkillTargetId` = `agents | claude`**，`skills.targets` 落盘到
   `agents.skills.targets`。`save_selection.request.targets` 可选——省略即保持已存值，
   所以不知道 target 的老 app 不会把安装收窄成零个 home。
2. **能力位 `features.skillInstallTargets`。** 老 daemon 仍在写两个 home；app 按这个位
   决定是否渲染「安装位置」两行，而不是渲染一个点了没反应的开关。
3. **`SkillOp` 带上 `targets`。** 一个 skill 可以在同一次收敛里「从 claude 删、在 agents
   更新」——把 target 挂在 op 上而不是收敛上，才不需要拆成两趟。线上 `AgentSkillsStatus.ops`
   仍是 `{kind,name}`，target 细节留在服务端。
4. **取消一个 home = 按既有确认流程删掉那里的托管副本。** 复用 `delete` op 与
   `confirmedRemovals`，没有新增删除语义。
5. **全部取消时 Save 禁用。** 否则「一个 home 都不写」会被静默解释成「卸载并保留偏好」。

- 改动：`packages/protocol/src/messages.ts` — `AgentSkillTargetId( s )Schema`、`skills.targets`、
  `AgentSkillsStatus.targets`、`save_selection.request.targets`、`features.skillInstallTargets`
- 改动：`packages/server/src/server/orchestration-skills/internal/{operations,sync,selection-store,controller,transaction}.ts`
  — `skillHomes()` / `resolveSelectedSkillTargets()`，`syncSkills` 收 `targetDirs[]`，
  `removeSkill(name, dirs)`，transaction 只给本次计划会动的 home 拍照
- 改动：`packages/server/src/server/{daemon-config-store,persisted-config,bootstrap,config,websocket-server,session}.ts`
- 改动：`packages/client/src/daemon-client.ts` — `saveAgentSkillsSelection(selection, targets?, confirmedRemovals?)`
- 改动：`packages/app/src/agent-skills/{index,selection-sheet,use-agent-skills}.tsx`、
  `packages/app/src/screens/project-settings-screen.tsx`、`packages/app/src/i18n/resources/*.ts`（9 locale）
- 改动：`packages/app/e2e/support/helpers/{agent-skills,seed-client}.ts`、
  `packages/app/e2e/browser/{agent-skills-settings,projects-settings}.spec.ts`
- 文档：`public-docs/skills.md` 安装段说明两个位置与关闭后的效果
- 验证：`npx vitest run packages/server/src/server/orchestration-skills`（105 passed, 1 skipped）；
  `npx vitest run packages/protocol/src/messages.agent-skills.test.ts`（6 passed）；
  `npx vitest run packages/app/src/agent-skills packages/app/src/i18n`（59 passed）；
  `npx playwright test --project=browser e2e/browser/agent-skills-settings.spec.ts`（12 passed，
  含新增的「选位置/取消位置」与「零位置禁用 Save」）；`npm run typecheck`、`npm run lint`、
  `npm run format:check` 全绿。
- byissue：`spec/` 里没有 skills 安装目标的现行描述，未改。

## 取舍

- **不引入第三个 target。** 这里只认 BySpace 真正会写的两个 home；`~/.codex/skills`
  仍是 `retiredDirs`，只清理不写。
- **uninstall 无视选择扫全部 home。** 它是「把这台机器上 BySpace 放的东西都拿走」，
  收窄到当前选择会留下取消掉那个 home 的残留。
