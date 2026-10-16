---
kind: note
title: "编排 skills 只装 ~/.agents 与 ~/.claude：目录取舍的依据，与退役目录靠 manifest 判归属"
created: 2026-10-16
---

# 编排 skills 只装 ~/.agents 与 ~/.claude

编排 skills 曾经往三个 agent home 同构写入：`~/.agents/skills`、`~/.claude/skills`、
`~/.codex/skills`。`skill.ts` 里的 `syncSkills` 对三个目录做完全相同的事，所以「三个」从来没被
论证过，只是照着最初那次实现复制下来。结果是给每个装过 skills 的用户（包括从不跑 Codex 的人）
在 `~/.codex` 里留一个目录。

## 取舍依据：先查 agent 自己读哪些 skill root

`~/.codex/skills` 是多余的，因为 Codex 的 app-server `skills/list` 也把 `~/.agents/skills`
当 skill root。`packages/server/src/server/agent/providers/codex-app-server-agent.test.ts` 里
「deduplicates Codex skill slash commands returned from multiple skill roots」这条用例直接把这个
路径写成了返回值的来源；`listCodexSkills`（同目录 `codex-app-server-agent.ts`）读的则是
`cwd/.codex/skills`、repo root 的 `.codex/skills` 与 `CODEX_HOME/skills`——即项目级路径和
`~/.codex`，而 `~/.agents/skills` 由 app-server 那边覆盖。

**新增 provider 时的动作：先确认它自己读哪些 skill root，再决定要不要为它多写一个目录。**
「别的 orchestrator 都有独立目录」不是理由；三个目录同构复制是这次踩坑的来源。

## 退役目录的清理：归属看 manifest，不看名字

`SkillTargets` 里 `codexDir` 被换成 `retiredDirs: readonly string[]`——它只减不增，不参与
`getSkillsStatus` 的 diff，也不是事务捕获的对象。清理在 `removeRetiredSkillCopies()`
（`internal/operations.ts`），判据是目录里有 `.byspace-managed-files.json`（BySpace 每写一个
skill 目录都会放的清单），不是目录名匹配 skill 名。

用名字匹配会误删同名目录：`~/.codex/skills/byspace` 完全可能是用户自己写的 skill 或别的工具装的。
用 manifest 则两种情形都对——老版本 BySpace 留下的、名字已经不再发布的副本仍是我们的（因为带
清单），用户自己的同名目录不是。

两处容易做错的细节：

- **`autoUpdateInstalledSkills` 里清理必须跑在 `state !== "drift"` 判断之前。** 退役清理不构成
  drift（状态扫描根本不看退役目录），所以放后面会让「已经是最新状态」的安装永远不触发清理——
  也就是绝大多数用户，那次改动等于没做。
- **收尾用 `fs.rmdir(root)` 并吞掉失败。** 非空目录 rmdir 会失败，这正好是「用户在这个 home 里
  有自己的 skills 就保留整个目录」的实现，不需要额外判断。

## 验证方式

`internal/operations.test.ts` 的 `describe("retired agent homes")` 覆盖四条：带 manifest 的副本
被删且 root 被收掉、root 里还有用户自己的 skill 时保留、同名但无 manifest 的目录不动、
`uninstall` 也清。写这类断言时注意 fixture 必须真的写 manifest——手写一个只有 `SKILL.md` 的目录
测出来的是「不删」，看起来通过其实没测到清理路径。

相关：[../issues/2026-10-16-x-ff-skill-install-selection-and-retire-codex-home.md](../issues/2026-10-16-x-ff-skill-install-selection-and-retire-codex-home.md)
（同一次改动还让首次 Install 先弹选择清单；`selectionSaved` 是那条的判据）。
