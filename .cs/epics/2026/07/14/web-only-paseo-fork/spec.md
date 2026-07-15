---
kind: epic
title: "建立 Web-only Paseo fork"
status: active
created: 2026-07-14
---

# 建立 Web-only Paseo fork

## 这个 Epic 要改变什么

把当前只有 CodeStable 骨架的项目建立成一份可独立维护和发布的 Paseo fork。它保留 hosted Web、加密 relay、本地 CLI/daemon 和完整 Provider 接入能力，但不再把 Electron、iOS 或 Android 当成产品目标，并移除与 Electron 绑定的内置 Browser。Pi 是产品体验上的唯一一等公民，其他 Provider 保留兼容与接入能力。

## 为什么现在做

Paseo 的多端产品面不断扩大，共享 App、协议和 daemon 因原生客户端、Electron 与附属能力发生频繁变化。个人使用真正依赖的是 Web + daemon 的远程 Agent 工作流。先建立可发布的精简 fork，才能在不继续承担无关客户端维护目标的前提下稳定使用，并为后续 Pi 优化和个人工具平台提供受控基础。

## 关联 Project Spec

- `.cs/spec/index.md`：当前仍是初始化骨架；本 epic 关闭后应把已成立的项目身份、使用路径、能力边界和部署形状写回其中。

## 当前方案

以 Paseo 当前主线历史为基础建立自己的仓库，不重写成熟 daemon 和 Provider。第一批变化先收缩发行面和用户界面：只构建浏览器 Web，保留 CLI/daemon、relay、协议、客户端库和全部 Provider；删除 Electron package、原生客户端发布与平台实现，以及内置 Browser 的完整跨层切片。随后重整 CI/CD，在自己的 GitHub 与 Cloudflare 账号下完成首次仓库发布、CLI 交付和 Pages 部署。

Provider 层作为上游对齐区域维护。直接 Provider、ACP、自定义 Provider 和 Catalog 不因本轮裁剪而重构；后续通过选择性吸收 Paseo 的 Provider、生命周期和安全修复来跟随 Agent CLI 当前版本。Pi 的专项体验优化属于建立基线后的下一批变化。

## 需求变化

项目将从空的 CodeStable 工作区变为一个 AGPL-3.0 的 local-first Agent Web 平台。主要图形入口只有 hosted Web；本地安装只需要 CLI/daemon。用户通过 direct 或加密 relay 连接本地执行环境，数据与执行继续由 daemon 掌握。Provider 接入面保持宽，但产品主动优化围绕 Pi 展开。

## 架构考量

- 不从零重写 daemon：四种主要直接 Provider 和 Agent 生命周期已经包含大量成熟兼容行为，重写会放大风险。
- 不裁剪 Provider 层：通用 ACP 和自定义 Provider 的边际维护成本低，保留上游形状更利于移植修复。
- 先形成 Web-only 构建，再删除深层平台代码：共享 Expo App 同时承担 Web 与原生渲染，删除顺序必须由可运行构建保护。
- Browser 按完整能力切片删除：只删 Electron pane 会留下协议、daemon broker 和工具入口的死边界。
- 发布边界保持分离：Web 由 Cloudflare Pages 托管；daemon/CLI 在本地运行；relay 只转发加密流量。
- 继续使用 AGPL-3.0，并保留上游版权和许可证要求。

## 统一语言

- **Web-only**：唯一主要图形界面是浏览器 Web；不表示把 daemon 搬到云端。
- **Provider 层**：直接 Provider、ACP、自定义 Provider、Catalog 及其共享契约；本轮整体保留。
- **一等公民**：会被持续真实验证和主动优化的 Provider；当前仅 Pi。
- **上游对齐区域**：为便于选择性移植 Paseo 更新而尽量保持文件与接口形状的代码区域，当前主要是 Provider 层。

## 当前推进

### 可推进范围

- 接入 Paseo git 历史，建立 Web-only 本地构建基线并完成客户端与 Browser 裁剪。
- 调整包、脚本、文档和 CI，使干净 checkout 只产生 Web、daemon/CLI 与必要 relay 产物。
- 在发布身份确认后创建 GitHub 仓库、发布 CLI/GitHub Release 并部署 Cloudflare Pages。

### Issues

- [ ] `.cs/issues/2026/07/14/open-web-only-fork-baseline.md`：建立可验证的 Web-only fork，完成源码与 CI 裁剪。
- [ ] `.cs/issues/2026/07/14/open-first-release-and-deployment.md`：在自己的 GitHub、包发布渠道和 Cloudflare 账号下完成首次交付。

### 暂停或废弃

- Go daemon 重写：当前没有已测量且无法由现有架构解决的问题，不进入首个基线。
- 通用插件系统：没有两个已验证的独立扩展需求，不提前建立运行时插件边界。

### 剩余阻碍

- 发布前需要确认工作名 `byspace` 是否为正式名称、GitHub 可见性、npm 包身份和首次发布渠道。
- npm 本机当前未认证；若采用 npm 发布，需要用户完成登录。

## 暂不推进范围

- Pi 专属交互与功能优化；基线发布后从真实使用问题切独立 issue。
- 云端账户、历史同步、离线云执行和设备管理控制面。
- 为 ACP Catalog 中每个 Agent 建立逐版本认证矩阵。
- 与 Electron、iOS 或 Android 有关的新替代实现。

## 未确认问题

- 对外命名与发布身份：当前目录提供了 `byspace` 工作名，但用户尚未确认最终大小写、npm 名称和仓库可见性。
- CLI 首次交付：需要确认采用 npm、GitHub Release，还是两者同时提供；不同选择会改变包重命名和 CI secret。
- Cloudflare 自定义域名：首版可以先使用 `pages.dev`，自定义域名尚未提出。

## 关闭条件

- 两个当前 issue 完成并经过相应构建、安装、连接和部署验证。
- GitHub 仓库、首次版本与 Cloudflare Pages 产物可以由用户实际访问。
- 用户明确确认 epic 可以关闭，再把项目稳定身份与边界写回 project spec。

## 合并回 Project Spec 的候选

- Byspace 的项目身份、目标用户和 local-first 使用叙事。
- hosted Web、relay、本地 daemon/CLI 与 Provider 的能力地图和使用路径。
- Web-only、Pi 一等公民、完整 Provider 接入和 AGPL-3.0 的稳定边界。
- 上游 Paseo 更新的选择性维护策略。

## 关闭回写

- 状态：关闭时改为 `closed`
- 合并位置：`.cs/spec/index.md` 及按实际复杂度形成的能力子层
- 保留材料：裁剪过程、一次发布证据和被排除方案留在 epic 与 issues 中

## 相关材料（按需）

- `.cs/talks/2026/07/14/建立-web-only-paseo-fork.md`：需要追溯原始动机、已确认决策和发布未知时阅读。
- `/Users/byte/workspace/forks/paseo/docs/architecture.md`：实现期间确认 Paseo 当前包边界、协议和部署模型时阅读。
