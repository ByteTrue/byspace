---
kind: issue
title: "切换 BySpace 0.2.0-beta.1 生产基线"
type: chore
status: open
created: 2026-07-19
epic: ".cs/epics/2026/07/19/upstream-thin-distribution/spec.md"
---

# 切换 BySpace 0.2.0-beta.1 生产基线

## 目标

在候选 branch、artifact、Web 与 Relay 全部验证并再次获得用户确认后，将 GitHub `main`、npm beta、Cloudflare Pages/Relay 和本机 daemon 切换到薄发行 beta.1；旧 Git、npm 0.1.1、Cloudflare deployment 与 `~/.byspace` 都保留明确回滚点。

## 范围

- 包含：push archive ref、替换/切换 GitHub main、等待 exact-SHA CI、发布 npm beta、部署 Pages/Relay、备份旧 home、安装并启动新 daemon、公开面和回滚验证。
- 不包含：删除旧 archive/release/home、把 beta 标记 npm latest、迁移旧 Agent 状态、跟进 post-beta upstream commits、关闭 Epic。

## 归属

- 隶属 epic：`.cs/epics/2026/07/19/upstream-thin-distribution/spec.md`
- 依赖：前三个 issue 完成且候选 exact SHA 固定。

## 背景与证据

这是不可逆风险最高的共享状态步骤：会改写公开主线、覆盖部署并停止生产 daemon。用户已批准直接 beta生产切换，但 CodeStable 危险操作契约要求在执行前用最终候选 SHA 和回滚清单再次确认。

## 质量目标

- **可靠性 / 可恢复性**：
  - 目标：任一 Git、npm、Cloudflare 或 daemon步骤失败，都能在不依赖未保存上下文的情况下恢复 0.1.1 服务。
  - 来源：Epic。
  - 预期证据：archive ref/home/deployment/package检查、实际 rollback smoke或等价演练。
- **信息安全性 / 完整性**：
  - 目标：只向 ByteTrue GitHub/npm/Cloudflare目标写入；Relay不代理 upstream；旧 daemon停止后才切 home与端口所有权。
  - 来源：Epic与项目安全边界。
  - 预期证据：目标账户/URL检查、CI/deploy logs、status/pairing检查。
- **功能适宜性 / 完整性**：
  - 目标：用户可从 npm 安装 `byspace`，从 Pages连接新 daemon，通过自托管 Relay创建 Pi max Agent。
  - 来源：用户决定。
  - 预期证据：生产 end-to-end smoke。

## 操作方案

实际执行前把以下占位替换为精确值并向用户展示：

- 旧 main/archive SHA与远端 archive ref；
- 新 candidate SHA与 beta base；
- 旧 `~/.byspace` 备份路径；
- npm version/dist-tag；
- Pages/Relay前后 deployment SHA；
- 本机旧/新 daemon Node、version、home、serverId；
- 每一步失败时的回滚命令。

切换顺序遵循“先保留、再发布、最后接流量”：先 push archive，再建立新 main并等 CI；npm beta发布后验证 clean install；Cloudflare部署后验证；最后停止旧 daemon、改名旧 home、用新 package启动 fresh home。任何阶段失败都停止继续推进，不删除旧资源。

## 风险边界

- 可能影响：公开 Git历史/default branch、npm registry、生产 Pages/Worker、本机 6777 daemon与 home。
- 明确不碰：旧 archive refs/tags/releases/home backup；npm `latest` 仍指 0.1.1直到正式版；用户其他全局 Node/Agent环境。
- 需要用户确认：**必须在候选 SHA 与完整回滚清单生成后再次确认，未确认不得执行。**

## 验证

- GitHub main/CI/archive、npm beta、Pages/Relay、daemon status/pair、Pi max生产 smoke。
- 旧版本回滚入口均可解析，备份 home未被新 daemon读取或改写。

## 执行记录

- 待执行；当前禁止共享状态操作。

## 关闭回写

- epic spec：记录生产 SHA、版本、部署、home与rollback结果。
- project spec：Epic人工关闭时再毕业薄发行架构。
- notes：记录正式版 release-train cutover复用步骤。
- AGENTS.md / CLAUDE.md：只保留正式版更新与危险操作短规则。
