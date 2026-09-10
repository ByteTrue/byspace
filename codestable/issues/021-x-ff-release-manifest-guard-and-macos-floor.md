---
kind: issue
title: "补发布前 manifest 校验、macOS 13 下限通知与本地标签对齐"
type: ff
status: closed
created: 2026-09-10
---

# 补发布前 manifest 校验、macOS 13 下限通知与本地标签对齐

> **读者：** 以后搜到这条时——改了啥、怎么信、动没动制度记忆。

Issue 019 关闭时留下的三个遗留，一次做完。

**1. 发布前 manifest 校验。** 先纠正 019 里记错的一条：`desktop-release.yml` **本来就有**内联校验，检查 `rolloutHours`、`releaseDate` 与 `version`。真正没人执行的是 `docs/release.md` 早已写明的那条不变量——mac manifest 必须同时带 arm64 与 x64 的 DMG 且各有 sha512。更新器按运行架构挑 DMG，只发一半的 manifest 会静默把另一半用户卡死在旧版本。

上游 v0.8.0-beta.1 的 `scripts/validate-desktop-manifests.mjs` 随同步进来了，但它只校验 rollout 三项加 `minimumSystemVersion`，不查架构覆盖。改写成校验我们真正的不变量，并把工作流里那段内联 node 换成调用它。

**2. macOS 13 下限。** Electron 44 要求 macOS 13，manifest 用 `minimumSystemVersion` 声明，macOS 12 从此收不到桌面更新。在 `CHANGELOG.md` 加 `## Unreleased` 段，用**引用块**写这条通知：`parseChangelogBody` 只把引用块当作需要用户行动的通知，同时输出到 GitHub release notes 和 F-Droid changelog，这是仓库既有机制。该标题没有日期，`parseChangelogEntries` 会跳过，不影响现有发布。

**3. 本地标签。** 019 里写的「`v0.7.0`、`v0.7.2`、`v0.7.3`、`v0.7.4` 与 origin 同名不同提交」是误报：当时的检查拿本地的**已剥离提交**去比 origin 的**标签对象**。按标签对象重比，真正冲突只有 `v0.8.0`（本地指向 `5e665de22` 一个 CI 提交，origin 指向 `ea676f463` 发布提交）。`git fetch origin --tags --force` 后归零。

- 改动：`scripts/validate-desktop-manifests.mjs` — 改为校验 rollout 三项、`minimumSystemVersion`，以及 mac manifest 的双架构 DMG 与 sha512
- 改动：`scripts/validate-desktop-manifests.test.mjs` — 七个用例：缺架构、缺校验和、丢失系统下限、错误 rollout 戳、非 mac manifest 不做 mac 检查、空输入、正常放行
- 改动：`.github/workflows/desktop-release.yml` — 内联 node 校验换成调用该脚本
- 改动：`CHANGELOG.md` — `## Unreleased` 引用块通知
- 改动：`docs/release.md` — 写明校验脚本负责这条不变量，以及平台支持变化必须用引用块
- 验证：`npx vitest run scripts/validate-desktop-manifests.test.mjs scripts/merge-mac-manifest.test.mjs` 8 通过；`ci-workflow` 与 `terminal-performance-workflow` 契约测试 0 失败；工作流 YAML 用 js-yaml 解析通过；lint、format:check 全过。标签侧核对：`git ls-remote` 与本地标签对象逐个比对后 MISMATCH 为 0
- codestable：已修正 `019-x-sync-upstream-to-0-8-0-beta.md` 关闭结论里那条标签误报；`spec/desktop-updates.md` 的 macOS 13 表述已在 019 关闭时写入，本次无需再改

顺手发现（不在本次范围）：本地有 215 个 origin 上不存在的历史标签，来自 reset 前的旧定制线。它们是我早前考古时把 `v0.7.2` 解析进 406 提交旧线的原因。删除会让那段历史变得不可达并可能被 GC，属不可逆操作，未处理。
