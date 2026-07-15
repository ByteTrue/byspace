---
kind: epic
title: "建立 Web-only BySpace"
status: active
created: 2026-07-14
---

# 建立 Web-only BySpace

## 这个 Epic 要改变什么

把项目建立成可独立维护和发布的 **BySpace**。它基于 Paseo 的 AGPL-3.0 代码与历史，保留 hosted Web、加密 relay、本地 CLI/daemon 和完整 Provider 接入能力，但不再把 Electron、iOS 或 Android 当成产品目标，并移除与 Electron 绑定的内置 Browser。Pi 是产品体验上的唯一一等公民，其他 Provider 保留兼容与接入能力。

## 为什么现在做

Paseo 的多端产品面不断扩大，共享 App、协议和 daemon 因原生客户端、Electron 与附属能力发生频繁变化。个人使用真正依赖的是 Web + daemon 的远程 Agent 工作流。先建立可发布的精简 fork，才能在不继续承担无关客户端维护目标的前提下稳定使用，并为后续 Pi 优化和个人工具平台提供受控基础。

## 关联 Project Spec

- `.cs/spec/index.md`：当前仍是初始化骨架；本 epic 关闭后应把已成立的项目身份、使用路径、能力边界和部署形状写回其中。

## 当前方案

以 Paseo 主线历史为基础，不重写成熟 daemon 和 Provider。已先建立只构建浏览器 Web 的基线，删除 Electron、原生客户端和内置 Browser。首次发布前先审阅并选择性移植最新上游提交，再把活跃代码中的产品身份完整改为 BySpace，最后在 ByteTrue GitHub 与 Cloudflare 账号下交付 CLI、Pages 和独立加密 Relay。

Provider 行为继续选择性吸收 Paseo 的 Provider、生命周期和安全修复，但不再为了 cherry-pick 便利保留 `Paseo/paseo` 命名。上游补丁进入 BySpace 时需要显式适配本项目命名和已裁剪能力。Pi 的专项体验优化属于首次基线发布后的下一批变化。

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

## 当前推进

### 可推进范围

- 已接入 Paseo git 历史并建立 Web-only 裁剪基线。
- 冻结并逐笔审阅当前 upstream 增量，用户批准后只移植适用于保留边界的提交。
- 全面完成 BySpace 命名迁移并重新验证所有发布产物。
- 创建 GitHub 仓库，发布 CLI/GitHub Release，并部署 Pages 与独立 Relay Worker/Durable Object。

### Issues

- [x] `.cs/issues/2026/07/14/open-web-only-fork-baseline.md`：建立可验证的 Web-only fork，完成源码与 CI 裁剪。
- [ ] `.cs/issues/2026/07/15/open-review-upstream-updates.md`：完整审阅冻结的 upstream 增量并移植获批提交。
- [ ] `.cs/issues/2026/07/15/open-complete-byspace-rename.md`：将活跃项目身份完整迁移到 BySpace/byspace/BYSPACE。
- [ ] `.cs/issues/2026/07/14/open-first-release-and-deployment.md`：在自己的 GitHub、npm 和 Cloudflare 账号下完成首次交付。

### 暂停或废弃

- Go daemon 重写：当前没有已测量且无法由现有架构解决的问题，不进入首个基线。
- 通用插件系统：没有两个已验证的独立扩展需求，不提前建立运行时插件边界。

### 剩余阻碍

- npm 本机当前未认证；发布 `@bytetrue/byspace` 前需要用户完成登录或配置 Trusted Publishing。

## 暂不推进范围

- Pi 专属交互与功能优化；基线发布后从真实使用问题切独立 issue。
- 云端账户、历史同步、离线云执行和设备管理控制面。
- 为 ACP Catalog 中每个 Agent 建立逐版本认证矩阵。
- 与 Electron、iOS 或 Android 有关的新替代实现。

## 未确认问题

- Cloudflare 自定义域名尚未提出；首版使用 `byspace.pages.dev` 与 `byspace-relay.bytetrue.workers.dev`。

## 关闭条件

- 当前四个 issue 完成并经过相应构建、安装、连接和部署验证。
- GitHub 仓库、首次版本与 Cloudflare Pages 产物可以由用户实际访问。
- 用户明确确认 epic 可以关闭，再把项目稳定身份与边界写回 project spec。

## 合并回 Project Spec 的候选

- BySpace 的项目身份、目标用户和 local-first 使用叙事。
- hosted Web、relay、本地 daemon/CLI 与 Provider 的能力地图和使用路径。
- Web-only、Pi 一等公民、完整 Provider 接入、彻底命名隔离和 AGPL-3.0 的稳定边界。
- 上游 Paseo 更新的选择性维护策略。

## 关闭回写

- 状态：关闭时改为 `closed`
- 合并位置：`.cs/spec/index.md` 及按实际复杂度形成的能力子层
- 保留材料：裁剪过程、一次发布证据和被排除方案留在 epic 与 issues 中

## 相关材料（按需）

- `.cs/talks/2026/07/14/建立-web-only-byspace.md`：需要追溯原始动机、已确认决策和发布未知时阅读。
- `/Users/byte/workspace/forks/paseo/docs/architecture.md`：实现期间确认 Paseo 当前包边界、协议和部署模型时阅读。
