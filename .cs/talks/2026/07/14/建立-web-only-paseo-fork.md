# 建立 Web-only Paseo fork talk

## 原始想法

Paseo 的 Cloudflare 托管 Web、加密 relay 和本地 CLI/daemon 组合很好用，但 Electron、原生 App、内置 Browser、语音和不断扩张的多端产品面让 Web 也持续承受无关功能带来的复杂度与回归。希望建立自己的 fork，先得到更稳定、可控的个人 Agent Web 平台，再逐步加入自己的 AI 与非 AI 工具。

## 真问题

需要保留 Paseo 已经成熟的本地 Agent 执行、远程 Web 控制与 Provider 兼容能力，同时把产品边界收回到个人使用的 hosted Web + local daemon，避免继续继承 Electron 和移动原生客户端的维护目标。Pi 是唯一的一等公民，fork 后最重要的差异化方向是改善 Pi 的使用表现；其他 Provider 能力保留，但不主导产品设计。

## 术语

- **Web-only**：唯一主要图形界面是浏览器 Web；不发布 Electron、iOS 或 Android 客户端。它不表示删除本地 CLI/daemon。
- **Provider 层**：直接 Provider、通用 ACP、自定义 Provider 配置和 Provider Catalog 的整体能力。本轮保留。
- **一等公民**：会围绕真实使用持续验证和主动优化的 Provider；当前仅 Pi。
- **滚动当前版本**：跟随 Agent CLI 的高频更新，维护当前可用行为，不建立宽泛的历史版本兼容矩阵。

## 已确认决策

- 许可证：fork 继续使用 AGPL-3.0，可以直接复用并选择性移植 Paseo 上游实现。
- 演化方式：不做全量 Go 重写；先把 Paseo 历史接入自己的仓库，再裁剪并独立维护。
- Provider：保留完整 Provider 基础设施和其他 Agent CLI 支持；Pi 是唯一一等公民。
- 客户端：删除 Electron、iOS、Android 及与这些客户端绑定的能力；保留 Web、CLI 和 daemon。
- Browser：删除与 Electron 绑定的内置 Browser 及其跨层协议和 daemon 能力。
- 发布：建立自己的远端仓库，完成首次发布、Cloudflare Pages 部署和相应 CI/CD 调整。
- 更新策略：Agent CLI 需要滚动跟进当前版本；通过保持 Provider 层接近上游和选择性吸收修复控制成本。

## 约束

- Hosted Web、加密 relay、本地 daemon 和 CLI 的核心使用路径不能因裁剪而破坏。
- Provider 层不是本轮裁剪目标；不要借机统一或重写成熟 Provider 适配器。
- Web 与 daemon 独立发布，需要保留明确的协议版本与能力发现。
- 发布、推送和 Cloudflare 部署已获用户授权；不可逆或需要用户账户交互的步骤仍需在执行前明确提示。
- npm 当前未登录，CLI 的最终公共发布渠道和包身份需要在发布前确认。

## 影响面、风险与取舍

- Paseo 的 Web、移动端和 Electron 共享 Expo App。删除发布链容易，删除原生依赖和平台分支需要确保 React Native Web 构建仍然成立。
- 内置 Browser 的 Electron 渲染实现较集中，但协议、daemon broker、工具目录和 UI panel 形成跨层切片，必须整体删除并验证。
- 大量源码删除会增加直接合并上游的冲突，因此 Provider 目录和共享 Provider 接口应尽量保持原形，后续以选择性 cherry-pick/移植为主。
- Cloudflare Pages 已具备本机部署权限；GitHub 仓库和 Pages 项目尚未创建。
- npm 未认证，不能在无人交互状态下直接发布公共 CLI 包。

## 分歧

- 项目对外名称暂以当前目录名 `byspace` 作为工作名，发布前需要最终确认大小写与包名。
- GitHub 仓库公开还是私有尚未确认。
- “首次发布”采用 GitHub Release、npm CLI 包或两者同时进行尚未确认。
- Cloudflare 是否长期只承担静态 Web 与盲 relay，还是以后加入账户控制面，留给后续平台规格讨论；本轮沿用 Paseo 的 local-first 形状。

## 初步出口草案

- 建议出口：新 Epic。
- 判断理由：变化横跨仓库历史、客户端裁剪、协议、daemon、构建发布、CI/CD 和远端部署，需要分批 issue 推进并在执行中收敛边界。
- 候选事项：
  - 建立 Web-only fork 基线：接入 Paseo 历史，删除 Electron、原生客户端和内置 Browser，保留 Web/CLI/daemon/Provider，并使相关构建和 CI 通过。
  - 完成首次发布与部署：创建远端仓库，配置 CI/CD，发布 CLI 与 GitHub Release，部署 Cloudflare Pages。
- 暂不纳入：Pi 专属体验优化、通用插件系统、云端账户控制面、Go 重写。
