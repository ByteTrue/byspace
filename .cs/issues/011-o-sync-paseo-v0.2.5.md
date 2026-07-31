---
kind: issue
title: "同步 Paseo v0.2.5 release delta"
type: chore
status: open
created: 2026-07-31
epic: ""
---

# 同步 Paseo v0.2.5 release delta

## 目标

从当前 BySpace `main` 移植 Paseo `v0.2.3..v0.2.5` 的适用聚合差异，不导入上游历史，不改变 BySpace 的 Web-only 产品边界、身份、发布渠道或生产环境。

## 范围

- 包含：跨 Host Project 分组、64 MiB socket hard cap 与超大 diff 状态、Provider/Agent 修复、CLI thinking、保留 Web UX、共享 file-tree 修复、必要 build 优化。
- 不包含：Electron/Desktop、native、Website、上游版本/包名/release 基础设施、Timeline rollback、已被上游 revert 的 worktree carry。

## 背景与证据

- BySpace base：`aa6e4c5e3fcfb720f37922839bf28324b63f6038`
- Baseline：Paseo `v0.2.3`, commit `43cf858c3760679ec9be805ba8b903cdf20f7103`, tree `54f51bd995bccf77d77ea3e33df4c39d37c033b2`
- Target：Paseo `v0.2.5`, commit `6fc491e6220fba6543bbbe4bf1b1f58cfe59228b`, tree `99ab03dfde2a54fa6c18749df0324250b5dfe4e6`
- Aggregate delta：40 commits、225 files、+6265/-3049。
- 未修改目标 release：`npm ci`、server build、typecheck、Web export 全部通过。

## 质量目标

- 功能适宜性：保留 release 中适用于 BySpace 的完整用户行为，不做半截跨层移植；以 focused tests 与 Web E2E 验证。
- 兼容性：新增 wire 字段保持 optional，新 capability 集中 gate；以协议双向解析测试验证。
- 性能效率与可靠性：采用上游 64 MiB physical-socket hard cap，并在约 23 MiB structured diff 上限提前返回 `diffTooLarge`，避免大 diff 断连；保留 Terminal soft backpressure。
- 信息安全性：Project grouping key 只用于展示，Host-local `projectId` 继续作为 mutation authority；路径、remote host、port 和凭据边界保持保守。
- 可维护性：按 release-level 行为垂直切片移植，不复制上游文件或建立平行实现。

## 操作方案

1. 先移植独立 Provider/Agent/CLI 修复。
2. 移植 Git/Relay large-diff 与 Forge-port 切片。
3. 移植 Project identity 跨层切片，保持 BySpace route 与权限模型。
4. 移植保留 Web/file-tree/build 行为，排除 unsupported surfaces。
5. 跑 focused tests、完整 gates、独立 review；无 deferred 后更新 baseline。

## 风险边界

- 可能影响：Project persistence/protocol/routing、Relay memory、Provider lifecycle、Web project/sidebar flows。
- 明确不碰：主 daemon、npm、Cloudflare、release tags、端口 6777、上游 Git ancestry。

## 验证

- 待执行。

## 执行记录

- 已冻结端点、完成四方向 aggregate-delta review，并验证未修改 v0.2.5 基线全绿。
- Provider/Agent/CLI 切片已移植：usage/CWD、Codex skills 与 plan approval race、OMP/Pi/Claude/Grok、CLI thinking、zsh runtime 隔离；focused tests 与静态检查见候选验证记录。
- Large-diff/Relay 切片已移植：64 MiB physical socket OOM backstop、精确 E2EE base64 尺寸反算、约 23 MiB structured diff 增量上限、optional `diffTooLarge` 跨协议/客户端与保留 Web Changes 状态；focused unit/daemon E2E/app 验证全绿，`build:server`、全 workspace typecheck/lint/format check 全绿。

## 关闭回写

- `docs/upstream-sync.md`、`docs/release.md`：仅在全部 retained slices 和 review blocker 完成后推进 baseline。
