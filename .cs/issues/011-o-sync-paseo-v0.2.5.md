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

- Retained Web correctness focused Vitest：6 files、224/224 tests 通过；review 修复后 file-tree focused rerun 10/10 通过。
- Older GitHub CLI repository-search slice：TDD 首轮按预期以缺少 `visibility` 的 ZodError 失败；实现后 server repository search 2/2、App add-project model 9/9 通过；`npm run typecheck` 通过，`npm run lint` 为 0 warnings / 0 errors，`npm run format` 通过。
- Build/test efficiency slice：`jsonl-rpc-process.test.ts` 1 file、8/8 tests 通过；最终 `npm run build:server` 证明仅 `highlight`/`relay` 并行，随后由 BySpace client workspace script 保持 `protocol -> client` declarations 顺序；`npm run typecheck` 通过，`npm run lint` 为 0 warnings / 0 errors，`npm run format` 通过。
- Windows-safe worktree setup：`node --test scripts/seed-worktree-dev-state.test.mjs` 6/6 通过，覆盖 platform-neutral setup config、durable JSON + optional server `.env` copy、runtime/tree/config symlink exclusion、symlink-alias source/target reset fence、initialized-target preserve/reset 与 missing-source no-op；targeted lint/format 全绿。
- v0.2.5 final completeness/security TDD：7 个 focused files、242/242 tests 通过。RED 阶段分别证明 HTML table 仍泄漏 raw tags、routed Project 未采用 hydrated cross-host key、Schedule 仍显示 grouped label 且 late hydration 不刷新、placement schema/server payload 丢失 Host-local id、fork route module 尚不存在；GREEN 后 table 转 sanitized Markdown bullets，opaque selection key 原样保留，Schedule 使用 Host-local projectName 并刷新 display，fork route 对 `projectId=prj_a` 与 `projectKey=remote:https://github.com/acme/shared` 只发送 `prj_a`，旧 placement 无 local id 时不发送 grouping key。HTML sanitizer review 又发现 active/unknown cell 与 Markdown URL destination breakout，修复后 focused 34/34：table cell 丢弃 active content、移除 unknown wrappers，所有生成的 link/image destination 拒绝 control/raw-tag breakout 并编码括号。`npm run format`、`npm run build:client`、全 workspace `npm run typecheck`、`npm run lint`（0 warnings / 0 errors）均通过。
- New Workspace shortcut Chromium E2E：最终 1/1 通过；本机 macOS 首轮固定 `Control+P` 未触发 macOS binding，helper 改为跨平台 `ControlOrMeta+P` 后通过。
- 全 workspace `npm run typecheck` 通过；`npm run lint` 0 warnings / 0 errors；`npm run format` 与最终 targeted formatter 通过。
- Web export：`npm run build:web --workspace=@bytetrue/byspace-app` 通过并输出 `packages/app/dist`。根 workspace 没有 `build:web` script，首次根命令按预期报 missing script，随后使用 App workspace script 验证。
- 独立 review：Forge/Markdown/shortcut **CLEAR**；file-tree 首轮两个 medium 可靠性问题（cache key/path identity、transient listing expansion 保留）已修复并复审 **CLEAR**；older-gh compatibility **CLEAR**；build/test efficiency **CLEAR**；final completeness 首轮发现 routed hydration、Schedule labels 与 fork Host-local authority 遗漏，均已修复并复审 **CLEAR**；HTML sanitizer 经三轮 attribute-breakout hardening 后最终 **CLEAR**；Windows-safe setup 首轮发现 config symlink 与 reset alias 风险，修复后复审 **CLEAR**。

## 执行记录

- 已冻结端点、完成四方向 aggregate-delta review，并验证未修改 v0.2.5 基线全绿。
- Provider/Agent/CLI 切片已移植：usage/CWD、Codex skills 与 plan approval race、OMP/Pi/Claude/Grok、CLI thinking、zsh runtime 隔离；focused tests 与静态检查见候选验证记录。
- Large-diff/Relay 切片已移植：64 MiB physical socket OOM backstop、精确 E2EE base64 尺寸反算、约 23 MiB structured diff 增量上限、optional `diffTooLarge` 跨协议/客户端与保留 Web Changes 状态；focused unit/daemon E2E/app 验证全绿，`build:server`、全 workspace typecheck/lint/format check 全绿。
- Cross-host Project identity/grouping 切片 review blockers 已修复：bootstrap 以 Host-local root 分配 opaque `projectId`、remote identity 仅保留在 protocol-bearing `projectKey`；workspace snapshot/delta authoritatively reconcile project descriptors；route hydration、Project Settings host switch、GitHub port URL 与跨 Host local-ID flows 已补 focused tests 和双 Host browser E2E。最终验证：139 个 focused tests、额外 reconciliation/bootstrap 21 tests、双 Host Chromium E2E 1/1、`build:client`、全 workspace typecheck、targeted lint/format 全绿。
- Retained Web correctness 切片已移植：self-hosted HTTP(S) Forge Web URL 保留非默认端口且 SSH/cloud alias 不携带端口；PR comment 的 emphasis/strikethrough HTML 安全降级为 sanitized Markdown token；全局 `/new` 保持 BySpace route ownership 并通过 dispatcher 接管 Cmd/Ctrl+P Project picker；file explorer 改用防递归纯 tree model，恢复过程只遍历可达 parent，过滤 malformed/duplicate/cycle cache，保留 hidden/expanded 并用 functional panel updates 避免恢复竞态。focused Vitest 224/224、review fix 10/10、shortcut Chromium E2E 1/1、全 workspace typecheck/lint、format、Web export 全绿；双方向独立 review 最终 CLEAR。
- Older GitHub CLI repository-search compatibility 切片已移植：`gh repo list`/`gh search repos` 仅请求旧版本支持的 `isPrivate`，daemon 映射回旧 client 必需的 `public`/`private` wire enum；Add Project UI 不再把 repository visibility 当作展示 fallback。保留现有 Forge runner 的 timeout/error/auth 边界与命令参数结构。focused Vitest server 2/2、App 9/9、全 workspace typecheck/lint、format 全绿。
- Build/test efficiency 切片已移植：根构建只并行互相独立的 highlight/relay，随后复用 BySpace client workspace build 保持 protocol declarations 先于 client 且移除重复 protocol build；server unit test 显式启用 Vitest file parallelism，daemon integration/E2E 继续串行；Windows stderr-timeout test 改用 parent-owned in-memory child streams，在计时请求前确定性写入 stderr。上游 selective-CI/path-filtering 提案（`76e336a1b`）由 BySpace 的全量 PR/push/release CI 策略明确 supersede，未移植且未改任何 release workflow。
- Windows-safe worktree setup 补齐：`byspace.json` setup 仅调用跨 shell 的 Node script；`scripts/seed-worktree-dev-state.mjs` 从 lifecycle env 读取 source/target，复制 durable agents/projects/config JSON 与可选 server `.env`，排除 pid/log/socket 与 tree/config/env symlink，以 realpath fence 防止 reset 经 checkout alias 删除 source，已有 target 默认不覆盖且支持显式 reset。6/6 Node tests 通过，并在 `docs/development.md` 固化 PowerShell/POSIX setup 约束；安全复审 CLEAR。
- Final completeness/security findings 已按 TDD 修复：PR comment HTML table 仅产出 sanitized Markdown list，active/unknown content 与 href/src Markdown breakout 不可穿透；New Workspace selection 按 `(serverId, Host-local projectId)` 接管 hydrated grouping key 并保留 opaque key；Schedule Host target label 与 late hydration 已修复；`ProjectPlacementPayload.projectId` 以 optional structural wire field 发布，fork-to-new-workspace 优先读取当前 Workspace 的 Host-local id、再兼容新 placement field，绝不回退 grouping `projectKey`。focused 242/242，sanitizer hardening 34/34，`build:client`、全 workspace typecheck/lint/format 全绿；三方向复审最终 CLEAR。

## 关闭回写

- `docs/upstream-sync.md`、`docs/release.md`：仅在全部 retained slices 和 review blocker 完成后推进 baseline。
