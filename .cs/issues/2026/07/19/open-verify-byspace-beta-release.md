---
kind: issue
title: "验证 BySpace 0.2.0-beta.1 薄发行"
type: chore
status: open
created: 2026-07-19
epic: ".cs/epics/2026/07/19/upstream-thin-distribution/spec.md"
---

# 验证 BySpace 0.2.0-beta.1 薄发行

## 目标

在不修改共享生产状态的前提下，证明 tracking branch 能产出可安装 npm beta、可导出的 BySpace Web、可独立部署的 Relay，以及完整且可重放的 downstream patch queue；为 production cutover 生成精确候选 SHA 与回滚清单。

## 范围

- 包含：focused/full static gates、upstream package/version校验、三平台可行的 package smoke、Web export、Relay dry run/E2E、Pi real catalog与 max smoke、独立 review、cutover候选与回滚演练。
- 不包含：npm publish、GitHub main改写、Cloudflare生产部署、停止生产 daemon、删除/迁移旧 home。

## 归属

- 隶属 epic：`.cs/epics/2026/07/19/upstream-thin-distribution/spec.md`
- 依赖：baseline 与 overlay issues 完成。

## 背景与证据

新主线的价值不只是“能编译”，而是未来每次正式 release 只需重放少量 patch。验证必须同时覆盖运行正确性与 patch queue 可维护性，并避免重复当前 0.1.0 全局 npm 安装故障。

## 质量目标

- **可靠性 / 无故障性与可恢复性**：
  - 目标：候选 artifact 在隔离 home/随机端口完成 daemon start/status/pair/stop；故障不触碰生产 6777/home。
  - 来源：Epic。
  - 预期证据：package smoke与隔离 daemon日志。
- **兼容性 / 互操作性**：
  - 目标：Web、CLI、daemon、protocol/client 全来自同一个 beta版本；clean npm tree无 invalid/missing dependency。
  - 来源：Epic。
  - 预期证据：manifest/tree/version检查和跨层测试。
- **可维护性 / 可测试性与可分析性**：
  - 目标：从 beta base 到候选 HEAD 的每笔 commit均为已批准 patch责任，独立 reviewers能直接解释和审查。
  - 来源：Epic。
  - 预期证据：commit ledger、diff review、下一正式版 dry rebase或冲突模拟（如可获得目标 tag）。
- **信息安全性 / 完整性**：
  - 目标：artifact和部署配置不包含 secrets；Relay E2E证明 ByteTrue endpoint工作且无 upstream代理。
  - 来源：Epic。
  - 预期证据：artifact内容检查、Wrangler dry run/E2E、secret扫描。

## 操作方案

1. 按责任运行最小 focused tests，再执行 upstream retained static/build/export gates。
2. 从候选 source 生成精确 beta tarball，安装到三个 clean-prefix形状；本机至少真实加载 native modules并跑隔离 daemon。
3. 验证 Web export metadata与可见 BySpace路径；验证 pairing offer含 BySpace Pages/Relay。
4. 验证 Relay worker构建、dry run和测试 endpoint，不部署生产。
5. 用 fresh-context只读 reviewers分别审查 upstream边界、package/deploy、安全/回滚和完整 diff。
6. 固定候选 SHA、archive refs、home backup名和 production cutover逐步命令，交给下个 issue二次确认。

## 风险边界

- 可能影响：临时安装 prefix、临时 daemon/home、测试 Cloudflare资源（若明确隔离）。
- 明确不碰：npm registry、GitHub default branch、生产 Pages/Worker、6777 daemon、`~/.byspace`。
- 需要用户确认：无；任何共享发布/部署动作后置。

## 验证

- 待执行。

## 执行记录

- 待执行。

## 关闭回写

- epic spec：记录候选 SHA、完整 gate和 reviewer结果。
- production cutover issue：写入精确执行/回滚清单。
- notes：记录正式版更新时可复用的验证顺序。
