---
kind: note
title: "编排 skills 装哪几个目录：按 agent 自己读的 skill root 定取舍，可按 home 开关，退役目录靠 manifest 判归属"
created: 2026-10-16
---

# 编排 skills 装哪几个目录

编排 skills 曾经往三个 agent home 同构写入：`~/.agents/skills`、`~/.claude/skills`、
`~/.codex/skills`。`syncSkills`（`internal/sync.ts`）对三个目录做完全相同的事，所以「三个」从来没被
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

## 两个 home 现在可以各自开关

留下的 `~/.agents/skills` 与 `~/.claude/skills` 也不再同构写入：用户可以在 `Choose skills` 里
只留一个。选中的 home 存在 `agents.skills.targets`，`save_selection.request.targets` 省略即保持
已存值，所以不知道 target 的老 app 不会把安装收窄成零个 home。wire 上的字段是顶层
`skillTargets` 而不是 `skills.targets`，理由见 [protocol-compatibility.md](../../docs/protocol-compatibility.md)。

关掉一个 home 产生的是普通的 `delete` op，走既有的 `confirmedRemovals` 确认流程，没有新增
删除语义。两个都关时 Save 禁用，否则「一个 home 都不写」会被静默当成「卸载并保留偏好」。
`uninstall` 是例外：它无视选择扫全部 home，因为它的意思是「把这台机器上 BySpace 放的东西都拿走」。

### 计划必须覆盖它写入的每个 home

`SkillOp` 带 `targets`，收敛按 op 逐个 sync。这两件事必须成对，否则 rollback 恢复不了：

- **`add` 的 targets 是 `[...missing, ...changed]`。** 只点名「缺这个 skill 的 home」而实际重写
  了所有 selected home，会让 transaction 没备份被覆盖的那份——用户在那个 home 里改过的字节
  rollback 之后消失。
- **两个 home 指向同一物理目录时不产生 `delete`。** 否则关掉别名 home 会连另一个仍在用的副本
  一起删掉。判定用 `realpath`；目录还不存在时它失败回退到 `path.resolve`，两个 home 归一成两个
  不同路径——这是**漏判**而不是误判，而且安全：目录不存在就没有副本可删，本来也不会产生 delete。

### 只改位置的保存，靠 targets 判断提交没提交

transaction manifest 原本只记 `previousSelection` / `nextSelection`。只改位置时这两者相同，
于是「中断」和「已提交」无法区分，恢复流程会把 staged 的副本当垃圾丢掉，而 targets 从未落盘。
所以 manifest 同时记 `previousTargets` / `nextTargets`，两者都匹配才 discard。

selection 与 targets 也必须一次写完：两次独立落盘会在第二次抛错时留下半更新的配置。

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

安装位置相关的三条回归测试都做过变异验证（拿掉对应修复就红）：`add` op 必须点名所有被修改的
home、被顺带覆盖的 home 在 rollback 后字节不变、两个 home 别名同一目录时只关掉第二个也能保存。
最后一条同时是「旧实现会报 Skills changed repeatedly」的复现。

相关：[../issues/2026-10-16-x-ff-skill-install-selection-and-retire-codex-home.md](../issues/2026-10-16-x-ff-skill-install-selection-and-retire-codex-home.md)
（同一次改动还让首次 Install 先弹选择清单；`selectionSaved` 是那条的判据）。
[../issues/2026-10-19-x-ff-skill-install-targets.md](../issues/2026-10-19-x-ff-skill-install-targets.md)
是按 home 开关那次的设计记录。
