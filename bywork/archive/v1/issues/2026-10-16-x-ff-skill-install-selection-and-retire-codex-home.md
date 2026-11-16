---
kind: issue
title: "编排 skills 安装改为先选择，并停止写入 ~/.codex"
type: ff
created: 2026-10-16
---

# 编排 skills 安装改为先选择，并停止写入 ~/.codex

安装编排 skills 时默认走「全部 skills」，直接把整包铺进三个 agent home，包括用户根本不用的
Codex；`~/.codex/skills` 因此成了用户目录里没人要的目录。选择功能其实早已存在，但入口只是一个
无文字的齿轮图标，用户第一次点 **Install** 时完全看不到它。

本次：

1. **安装目标收敛为 `~/.agents/skills` 与 `~/.claude/skills`。** Codex 自己的 `skills/list`
   也把 `~/.agents/skills` 当 skill root（`codex-app-server-agent.test.ts` 里就有该路径的用例），
   所以 Codex 不再需要独立目录。
2. **首次 Install 先弹选择清单。** `AgentSkillsStatus` 新增 `selectionSaved`，回答「用户是否
   选过」——`selection` 字段答不了：默认值 `{mode:"all"}` 同时也是合法的已保存值。没选过 →
   Install 打开清单并把主按钮文案换成 Install；选过 → 按已存选择直接装。
3. **选择入口显眼化。** 图标按钮改为带文字的 ghost 按钮，compact 布局下仍只显示图标。
4. **退役目录自动清理。** `SkillTargets.codexDir` → `retiredDirs`；每次收敛（含 `autoUpdate`，
   它跑在 drift 判断之前，否则已是最新状态的安装永远不会触发清理）删掉退役 home 下带
   `.byspace-managed-files.json` 的目录，再用 `rmdir` 收尾——非空则失败，所以用户放在
   `~/.codex/skills` 里的自己的 skill 会留住整个目录。

- 改动：`packages/protocol/src/messages.ts` — `AgentSkillsStatusSchema.selectionSaved`（可选，纯新增）
- 改动：`packages/server/src/server/orchestration-skills/internal/{paths,sync,operations,transaction,controller}.ts`
- 改动：`packages/app/src/agent-skills/{index,selection-sheet}.tsx`、`packages/app/src/i18n/resources/*.ts`（9 locale，含把 `~/.codex` 从卸载/删除提示里去掉）
- 改动：`packages/app/e2e/support/helpers/agent-skills.ts`、`packages/app/e2e/browser/agent-skills-settings.spec.ts`
- 文档：`public-docs/skills.md` 安装段说明目标目录与首次选择
- 验证：`npx vitest run packages/server/src/server/orchestration-skills --bail=1`（5 files, 98 passed）；`npx vitest run packages/app/src/agent-skills --bail=1`（5 passed）；`npx playwright test --project=browser e2e/browser/agent-skills-settings.spec.ts`（10 passed，含新增的首次安装用例）；`npm run typecheck`、`npm run lint`、`npm run format` 全绿。
- byissue：无影响（`spec/terminal.md` 只提到设置页的 section 顺序，未涉及目标目录或安装流程）；沉淀到 `notes/2026-10-16-skill-install-targets-and-retired-dirs.md`

顺手发现：`~/.codex/skills` 的清理只覆盖带 manifest 的目录，历史上被用户手改过的副本会留下——按「目录不是我们的一律不动」的既有取舍，这是有意的。
