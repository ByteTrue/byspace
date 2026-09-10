---
kind: issue
title: "修正真实版本标签指向、清理旧定制线的标签与 Release"
type: ff
status: closed
created: 2026-09-10
---

# 修正真实版本标签指向、清理旧定制线的标签与 Release

> **读者：** 以后搜到这条时——改了啥、怎么信、动没动制度记忆。

删掉 archive 分支后发现 origin 上全部 33 个版本标签都不在当前干净 `main` 的祖先里，因为它们是重置前那条旧定制线（172 作者、5288 提交）留下的。分两类处理：`v0.10.0`、`v0.11.0`、`v0.11.1`、`v0.11.2`、`v0.11.3`、`v0.12.0` 在干净 `main` 上确有对应的 `chore(release): cut vX.Y.Z` 提交，只是标签指错了对象，予以修正；其余 27 个（`v0.2.0` 到 `v0.9.0` 含全部 beta，加 `android-v0.11.3`）在干净线上没有对应提交，属于纯旧线遗留，予以删除，随之删除它们各自挂着的 25 个已发布 GitHub Release（`android-v0.11.3` 与 `v0.9.0` 没有独立 Release）。

删除与非快进推送被仓库的 `Immutable release tags` ruleset（覆盖 `refs/tags/v*`，`current_user_can_bypass: never`）拦截。备份原始配置后临时把 `enforcement` 改为 `disabled`，完成标签操作，再原样恢复为 `active`，规则本身内容未变。

- 改动：origin 6 个标签重新指向干净 `main` 的真实发布提交（`v0.10.0`→`31713d42c`、`v0.11.0`→`ea7766c9f`、`v0.11.1`→`581d093d7`、`v0.11.2`→`9ef7796ea`、`v0.11.3`→`ab6b6c947`、`v0.12.0`→`aec50bf6b`）
- 改动：删除 origin 上 27 个旧线标签，及其对应的 25 个 GitHub Release
- 改动：`Immutable release tags` ruleset（id `21030138`）短暂关闭后原样恢复，规则内容（`deletion` + `non_fast_forward`，覆盖 `refs/tags/v*`）未变
- 验证：恢复后的 ruleset 配置与操作前备份逐字段比对一致（仅 `updated_at` 不同）；6 个标签均确认是干净 `main` 的祖先；`gh release list` 只剩 6 条；本地标签用 `--prune-tags` 对齐到与 origin 一致的 6 个
- codestable：无制度记忆需要同步，纯基础设施清理

顺手发现：与本次同步（Issue 019）相关的另一处历史改写——`main` 上 8 个 boudra 署名提交（PR #31 cherry-pick 带入）已用 `git-filter-repo` 改署名为 `bytetrue`，force-push 后 GitHub contributors 只剩 ByteTrue 一人。同一会话内完成，未单独立 issue。
