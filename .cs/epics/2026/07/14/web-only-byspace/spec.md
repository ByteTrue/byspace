---
kind: epic
title: "建立 Web-only BySpace"
status: closed
created: 2026-07-14
---

# 建立 Web-only BySpace

## 这个 Epic 要改变什么

把项目建立成可独立维护和发布的 **BySpace**。它基于 Paseo 的 AGPL-3.0 代码与历史，保留 hosted Web、加密 relay、本地 CLI/daemon 和完整 Provider 接入能力，但不再把 Electron、iOS 或 Android 当成产品目标，并移除与 Electron 绑定的内置 Browser。Pi 是产品体验上的唯一一等公民，其他 Provider 保留兼容与接入能力。

## 为什么现在做

Paseo 的多端产品面不断扩大，共享 App、协议和 daemon 因原生客户端、Electron 与附属能力发生频繁变化。个人使用真正依赖的是 Web + daemon 的远程 Agent 工作流。先建立可发布的精简 fork，才能在不继续承担无关客户端维护目标的前提下稳定使用，并为后续 Pi 优化和个人工具平台提供受控基础。

## 关联 Project Spec

- `.cs/spec/index.md`：已接收本 Epic 验证成立的项目身份、使用路径、能力地图、发行拓扑、维护策略和稳定边界。

## 当前方案

BySpace 已在 Paseo 主线历史上形成独立维护基线：成熟 daemon、协议和 Provider 保留，Electron、原生客户端与内置 Browser 按完整能力切片删除；活跃身份统一为 BySpace；上游变化通过完整账本选择性 replay；公开发行由 ByteTrue GitHub、单包 npm、Cloudflare Pages、独立 encrypted Relay 和双架构 Docker 组成。

Provider 行为继续选择性吸收 Paseo 的生命周期、可靠性和安全修复，但每批都显式适配 BySpace 命名和已裁剪能力。Pi 的专项体验优化属于这个已发布基线之上的独立变化，不再属于本 Epic。

## 需求变化

项目将从空的 CodeStable 工作区变为一个 AGPL-3.0 的 local-first Agent Web 平台。主要图形入口只有 hosted Web；本地安装只需要 CLI/daemon。用户通过 direct 或加密 relay 连接本地执行环境，数据与执行继续由 daemon 掌握。Provider 接入面保持宽，但产品主动优化围绕 Pi 展开。

正式显示名是 `BySpace`；仓库、npm、CLI、域名、环境变量和文件系统标识按平台约束使用小写 `byspace` 或大写 `BYSPACE`。首次发布前活跃代码、配置、包、工具协议、文档和路径不再残留 Paseo 产品命名。

## 架构考量

- 不从零重写 daemon：四种主要直接 Provider 和 Agent 生命周期已经包含大量成熟兼容行为，重写会放大风险。
- 不裁剪 Provider 行为：通用 ACP 和自定义 Provider 的边际维护成本低；全面改名后通过行为与测试移植上游修复，而不是要求补丁无冲突 cherry-pick。
- 先形成 Web-only 构建，再删除深层平台代码：共享 Expo App 同时承担 Web 与原生渲染，删除顺序必须由可运行构建保护。
- Browser 按完整能力切片删除：只删 Electron pane 会留下协议、daemon broker 和工具入口的死边界。
- 发布边界保持分离：Web 由 Cloudflare Pages 托管；daemon/CLI 在本地运行；relay 只转发加密流量。
- 继续使用 AGPL-3.0，并保留上游版权和许可证要求。
- 全面改名是一次性边界：包名、环境变量、默认目录、配置文件、工具名、类型与文件名统一后，不保留旧名 fallback，避免双命名长期扩散。

## 统一语言

- **BySpace**：正式产品显示名，固定大写 `B` 和 `S`。
- **byspace**：仓库、npm、CLI、域名、配置文件和其他要求小写的机器标识。
- **BYSPACE\_\***：运行时环境变量前缀。
- **Web-only**：唯一主要图形界面是浏览器 Web；不表示把 daemon 搬到云端。
- **Provider 层**：直接 Provider、ACP、自定义 Provider、Catalog 及其共享契约；整体保留。
- **一等公民**：会被持续真实验证和主动优化的 Provider；当前仅 Pi。
- **允许保留的 Paseo 痕迹**：AGPL/版权、README 上游归属、Git remote 与历史、历史 changelog/issue 证据；活跃接口和实现不得依赖旧名。

## 完成范围

### 已完成

- 已接入 Paseo git 历史并建立 Web-only 裁剪基线。
- Upstream 已完整审阅并同步到 cursor `6804882761fcb9a511338f1fed19b9ed45e99e45`；后续按 `.byspace/upstream-sync.json`、`docs/upstream-sync.md` 和 repo-local skill 继续。
- 活跃项目身份已完整迁移为 BySpace/byspace/BYSPACE，并由 branding gate 保护。
- `ByteTrue/byspace`、`@bytetrue/byspace@0.1.0`、Pages、Relay、GitHub Release 和双架构 Docker 已交付；npm Trusted Publisher 与 Cloudflare CI/CD 已配置，Cloudflare 部署步骤和凭据已通过显式 workflow dispatch 验证。

### Issues

- [x] `.cs/issues/2026/07/14/closed-web-only-fork-baseline.md`：建立可验证的 Web-only fork，完成源码与 CI 裁剪。
- [x] `.cs/issues/2026/07/15/closed-review-upstream-updates.md`：完整审阅冻结的 upstream 增量并移植获批提交。
- [x] `.cs/issues/2026/07/15/closed-complete-byspace-rename.md`：将活跃项目身份完整迁移到 BySpace/byspace/BYSPACE。
- [x] `.cs/issues/2026/07/14/closed-first-release-and-deployment.md`：在自己的 GitHub、npm 和 Cloudflare 账号下完成首次交付。

### 暂停或废弃

- Go daemon 重写：当前没有已测量且无法由现有架构解决的问题，不进入首个基线。
- 通用插件系统：没有两个已验证的独立扩展需求，不提前建立运行时插件边界。

### 剩余阻碍

- 无。Cloudflare 的自动 `workflow_run` 触发会在下一次 `main` CI 后自然观测；部署步骤、凭据和生产资源已通过显式 workflow dispatch 验证。下一版本首次 OIDC publish 后收紧 npm token access 属于后续安全维护。

## 暂不推进范围

- Pi 专属交互与功能优化；基线发布后从真实使用问题切独立 issue。
- 云端账户、历史同步、离线云执行和设备管理控制面。
- 为 ACP Catalog 中每个 Agent 建立逐版本认证矩阵。
- 与 Electron、iOS 或 Android 有关的新替代实现。

## 已确认边界

- 首版使用 `byspace.pages.dev` 与 `byspace-relay.bytetrue.workers.dev`；自定义域名不属于本 Epic。

## 关闭条件

- [x] 当前四个 issue 完成并经过相应构建、安装、连接和部署验证。
- [x] GitHub 仓库、首次版本与 Cloudflare Pages 产物可以由用户实际访问。
- [x] 用户已明确确认关闭 Epic；稳定身份与边界已写回 project spec。

## 已合并到 Project Spec

- BySpace 的项目身份、目标用户和 local-first 使用叙事。
- hosted Web、relay、本地 daemon/CLI 与 Provider 的能力地图和使用路径。
- Web-only、Pi 一等公民、完整 Provider 接入、彻底命名隔离和 AGPL-3.0 的稳定边界。
- 上游 Paseo 更新的选择性维护策略。

## 关闭回写

- 状态：`closed`（用户于 2026-07-16 明确确认关闭）。
- 合并位置：`.cs/spec/index.md` 的项目定义、当前方向、能力地图、使用路径、架构落点、统一语言、当前边界和关键考量。
- 组织理由：这些内容共同描述当前稳定产品，应由 project spec 的单一入口统帅；实现批次、逐笔 upstream disposition 和一次发布日志继续留在 Epic 与 closed issues 中。
- 验证：最终发行 CI `29483121410` 与收尾 CI `29501360798` 成功；显式 Cloudflare App deploy `29505394675` 与 Relay deploy `29505398465` 成功；npm、GitHub Release、Pages、Relay 和 Docker 已线上验证。

## 相关材料（按需）

- `.cs/talks/2026/07/14/建立-web-only-byspace.md`：需要追溯原始动机、已确认决策和发布未知时阅读。
- `/Users/byte/workspace/forks/paseo/docs/architecture.md`：实现期间确认 Paseo 当前包边界、协议和部署模型时阅读。
