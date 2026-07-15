---
kind: issue
title: "完成首次发布与部署"
type: feature
status: open
created: 2026-07-14
epic: ".cs/epics/2026/07/14/web-only-paseo-fork/spec.md"
---

# 完成首次发布与部署

## 目标

用户可以从自己的 GitHub 仓库获得首个版本，在本机安装并运行 CLI/daemon，并通过部署在自己 Cloudflare 账号下的 Pages Web 连接它；后续提交和版本可由收缩后的 CI/CD 重复构建与发布。

## 范围

- 包含：
  - 确认正式项目名、仓库可见性、版本号、CLI 包身份和发布渠道。
  - 创建自己的 GitHub 仓库，配置 `origin`，保留 Paseo 为 `upstream`。
  - 更新品牌、包元数据、版本与发布脚本到自己的身份。
  - 配置只面向 Web、daemon/CLI、relay 的 CI/CD。
  - 创建 Cloudflare Pages 项目并部署 Web。
  - 交付可安装 CLI/daemon，创建首次 GitHub Release；若选择 npm，同时完成 npm 发布。
  - 验证新安装 CLI 与已部署 Web 的连接。
- 不包含：
  - 自定义域名，除非用户在执行前提供。
  - Cloudflare 账户控制面或云端持久化。
  - Pi 专属产品优化。

## 归属

- 隶属 epic：`.cs/epics/2026/07/14/web-only-paseo-fork/spec.md`
- 相关 spec：`.cs/epics/2026/07/14/web-only-paseo-fork/spec.md`

## 背景与证据

- GitHub CLI 已登录 `ByteTrue`，`ByteTrue/byspace` 当前不存在。
- Wrangler 已登录用户自己的 Cloudflare 账号并具备 Pages 写权限，`byspace` Pages 项目当前不存在。
- npm 当前返回未认证；`byspace` 与 `@bytetrue/byspace` 查询不到现有包，但实际命名与发布权限仍需登录后确认。
- 用户已明确授权创建仓库、推送、发布和 Cloudflare Pages 部署。

## 待确认问题

- 正式名称是否为 `byspace`，GitHub 仓库是否公开。
- 首个版本是否为 `v0.1.0`。
- CLI 使用 npm、GitHub Release 或两者；若 npm，发布采用哪个用户/scope。
- Pages 首版是否接受 `byspace.pages.dev`，是否同时部署 relay。

## 现状如何工作

Paseo 当前通过独立 GitHub workflows 部署 Cloudflare Pages、relay、网站、桌面与移动产物，并通过多 workspace npm 发布 protocol/client/server/relay/CLI。Fork 基线完成后，发布面只剩 Web、必要 relay 和本地 CLI/daemon，需要把仓库身份、包依赖、版本同步、CI secrets 与 Cloudflare 项目一起迁移。

## 影响范围

- 必须修改：Git remotes、包名与元数据、版本/发布脚本、GitHub workflows、Cloudflare Pages 配置、安装说明。
- 需要验证：全新机器/目录安装 CLI、daemon 启动、Web 连接、release 资产、CI 权限与 secret、Pages 回滚入口。
- 仍待调查：精简后的 CLI 是否继续发布多个内部 npm 包，还是形成单包交付；仓库可见性和 npm 身份确认后决定。

## 方案判断

先完成 fork 基线再设计最终交付形状。优先复用现有 npm workspace 发布能力，避免为首次版本引入新的 bundler 或安装器；若 npm 身份暂时阻塞，则先完成 GitHub Release 和 Pages 部署，但不能把仅能在源码 checkout 运行误报为已交付 CLI。

## 实现设计

- 等待基线 issue 完成和发布身份确认后补齐。

## 验证

- 待执行。

## 执行记录

- 待执行。

## 关闭回写

- epic spec：回写正式身份、发布拓扑、安装路径与实际验证。
- project spec：仅在 epic 关闭时毕业。
- notes：记录 Cloudflare/npm/GitHub 发布中的可复用坑点。
- AGENTS.md / CLAUDE.md：只写每次发布前都必须知道的短规则或 notes 指针。
- tools：发布流程稳定重复后再考虑脚本化。

## 关闭结论

- 关闭判断：待用户在发布验证完成后授权关闭。
- 验证摘要：待执行。
- 回写位置：待关闭。
- 遗留事项：待执行确认。
