# 仓库身份清理与待办迁移 talk

讨论日期：2026-09-10。参与：Owner、AI。这是一份收尾/交接记录：话题已收束到"等外部事件后再继续"，不是尚在争论的开放讨论。

---

## 1. 起因：Issue 019 关闭后的三个遗留，快速处理

Issue 019（同步 `v0.8.0-beta.1`）关闭时留了三条遗留：发布前 manifest 校验缺口、macOS 13 下限要写进发布说明、本地标签与 origin 疑似冲突。Owner 说"三个直接都快速做掉"。按快改处理，记在 [`021-x-ff-release-manifest-guard-and-macos-floor.md`](../issues/021-x-ff-release-manifest-guard-and-macos-floor.md)：

- 新增 `scripts/validate-desktop-manifests.mjs` 校验 mac manifest 双架构 DMG 与 sha512，接进 `desktop-release.yml`。
- `CHANGELOG.md` 加 `## Unreleased` 引用块，写 Electron 44 要求 macOS 13。
- 标签冲突是误报（拿本地已剥离提交比了 origin 的标签对象），`git fetch --tags --force` 后即归零，真正冲突只有 `v0.8.0` 一个。

## 2. Owner 看到 GitHub 页面人数异常，追查根因

Owner："GitHub 页面显示很多人，实际上我 fork 项目都不会出现这些 contributor"。查证：

- GitHub `contributors` API 当时只报 2 人（ByteTrue 87、boudra 8），但 origin 上有一个 `archive/main-before-v0.10.0-history-squash` 分支，172 个作者、5288 个提交，是切到干净基线之前的旧定制线。GitHub 仓库首页的 Contributors 计数会把非默认分支也扫进去。
- Owner 决定："都删，上游发布 0.8.0 正式版之后就分道扬镳"。删除 origin 上的 archive 分支（5288 个提交不再可达）；本地清理 215 个仅存在于本地、origin 上没有的历史标签。

## 3. main 上还留着 boudra 的署名，Owner 要求改掉

`main` 上有 8 个提交（PR #31 从上游 cherry-pick 带入的修复）作者是 Mohamed Boudra，committer 已经是 bytetrue。Owner："第一个我要动"，明确"只改署名，保留代码"。

- 用 `git-filter-repo` 在临时克隆里把这 8 个提交的 author 改成 `bytetrue <bytetrue@outlook.com>`，验证内容树、提交顺序、提交信息完全不变，只有 author 字段变了。
- force-push 覆盖 `main`（`43952f0f5` → `3339a8db4`），本地对齐。GitHub contributors 降到只剩 ByteTrue。
- **一次 force-push 被 Claude Code 的权限弹窗拒绝**，AI 未重试同一调用，说明风险后由 Owner 明确说"继续，确认"才重试成功。这不是对话确认失效，是权限弹窗本身被点了拒绝或误触，值得下次留意。

## 4. 标签本身也全部指错，牵出仓库级 ruleset

Owner："都清理，只保留最干净的"。逐个核对 origin 全部 33 个版本标签，发现**没有一个**指向当前干净 `main` 的历史：

- `v0.10.0`、`v0.11.0`、`v0.11.1`、`v0.11.2`、`v0.11.3`、`v0.12.0` 这 6 个是真实版本，干净 `main` 上确有对应的 `chore(release): cut vX.Y.Z` 提交，只是标签指错了对象。
- 其余 27 个（`v0.2.0` 到 `v0.9.0` 含全部 beta，加 `android-v0.11.3`）在干净线上根本没有对应提交，纯粹是旧线遗留，各自还挂着一个已发布的 GitHub Release（25 个，`android-v0.11.3` 和 `v0.9.0` 没有独立 Release）。

删除/强推标签被仓库的 `Immutable release tags` ruleset（id `21030138`，覆盖 `refs/tags/v*`，`current_user_can_bypass: never`）拦截。Owner 选择"临时关闭规则、做完、原样恢复"。执行：备份规则 JSON → 关闭 → 6 个标签重打到正确提交并强推 → 27 个旧标签连同 25 个 Release 一并删除 → 规则原样恢复为 active（除 `updated_at` 外逐字段一致）。记在 [`022-x-ff-retag-releases-and-drop-old-line-history.md`](../issues/022-x-ff-retag-releases-and-drop-old-line-history.md)。

结果：origin 只剩 6 个标签、6 个 Release，全部指向真实历史。

## 5. Contributors 依然显示 92，根因是 GitHub 永久保留的 PR ref

Owner 截图：Releases 正确显示 6，但 **Contributors 仍是 92**。排查证实这不是缓存延迟：

- GitHub 给每一个 PR 都保留一个永久 ref `refs/pull/N/head`，创建后就存在，关闭或合并都不删，没有 git 命令或 API 能删除它，独立于分支、标签、ruleset 之外。
- 逐个检查早期 PR：`refs/pull/1/head` 到 `refs/pull/3/head` 是 306～318 个提交的更早期定制线，`refs/pull/4/head` 起跳到 5200 多个提交，与 archive 分支同源，均**不是**当前 `main` 的祖先。
- 结论：只要这些 PR 存在过，这条仓库上的 Contributors 数字就洗不干净，这是 GitHub 的仓库结构限制，不是配置问题。唯一彻底的路是新建仓库，把干净历史（`main` 的 95 个提交，只有 ByteTrue 一个作者）整个推过去，不经过 PR。

## 6. Owner 决定先完成最后一次上游同步，再迁移

Owner 想等上游发布 `0.8.0` 正式版（当前 `getpaseo/paseo` 最新是 `v0.7.2`（latest）与 `v0.8.0-beta.1`（pre-release），正式版尚未发布）后做最后一次同步，再谈迁移。AI 给出的理由：

1. 迁移会把当前提交历史原样带过去；先同步再迁移，只需在旧仓库处理一次同步冲突和验证，不用在新仓库重来一遍。
2. 这次最后的同步应该在旧仓库走完整个生命周期（含 PR），把它当作旧仓库的收尾动作；迁移后新仓库不再开 PR、只用直接推送或其他不产生永久 PR ref 的流程，否则会把同样的坑复制过去。
3. 迁移本身需要另外核对 CI secrets、npm 发布权限、Cloudflare/域名等外部依赖，最好不要和上游同步的时间窗口重叠。

**已确认：** 分道扬镳的时机是"上游 0.8.0 正式版发布 + 最后一次同步合并之后"，不是现在。

---

## 出口

**当前状态（2026-09-10 校验过）：**

- `main` 本地与 origin 一致：`a41750604f9c4c5b5512aad79084c30d23c9c2c3`。
- origin 只有 `main` 一个分支，6 个标签（`v0.10.0`–`v0.12.0` 系列），6 个 GitHub Release，全部指向真实历史。
- `Immutable release tags` ruleset（id `21030138`）状态 `active`，规则未变。
- 上游 `getpaseo/paseo` 当前 stable 是 `v0.7.2`，`v0.8.0-beta.1` 是 pre-release；`v0.8.0` 正式版尚未发布。
- 已完成的同步记录：[`019-x-sync-upstream-to-0-8-0-beta.md`](../issues/019-x-sync-upstream-to-0-8-0-beta.md)（本轮同步的 base 是 `9400a49af`，target 是 `4eab53e24` / `v0.8.0-beta.1`）。

**建议的下一步（按顺序，触发条件是上游发布 0.8.0 正式版）：**

1. 用 `.agents/skills/upstream-sync/SKILL.md` 的 `check` 操作确认 `getpaseo/paseo` 是否已发布 `v0.8.0`（非 beta）正式 tag。
2. 若已发布，走 `prepare` → `verify` → `submit` → `merge` 全流程，`LAST_UPSTREAM_SHA` 用本轮的目标 `4eab53e24`（`v0.8.0-beta.1`）。按已确认的分歧清单处理冲突：保留面见 `codestable/spec/` 各章节，尤其 `agent-conversation.md`（Pi turn 结算规则）与 `desktop-updates.md`（macOS 13 下限、DMG 交接顺序）。
3. 合并后关闭对应 Issue，按 close 规则毕业回写。
4. 这是与上游的最后一次同步，合并后可以在 `codestable/vision/index.md` 的"跨区域边界"里记一句"自此断开上游同步"，具体措辞留到那天再定。
5. 完成上述之后，再启动仓库迁移：新建仓库、推送干净历史（不经过 PR）、迁移 CI secrets、npm 发布权限（`@bytetrue/byspace`）、Cloudflare Pages 域名（`app.byspace.cc.cd` / `app-beta.byspace.cc.cd`）、GHCR 镜像路径、`Immutable release tags` 这类 ruleset 需要在新仓库重建。旧仓库处理方式（归档/转私有/保留）到时再定。

**暂不纳入：** 迁移本身现在不做；GitHub `refs/pull/*` 遗留问题不再尝试用 git/API 清理，已确认无解，只能靠迁移绕开。
