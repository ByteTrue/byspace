---
kind: issue
title: "完成首次发布与部署"
type: feature
status: closed
created: 2026-07-14
epic: ".cs/epics/2026/07/14/web-only-byspace/spec.md"
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

- 隶属 epic：`.cs/epics/2026/07/14/web-only-byspace/spec.md`
- 相关 spec：`.cs/epics/2026/07/14/web-only-byspace/spec.md`

## 背景与证据

- GitHub CLI 已登录 `ByteTrue`，`ByteTrue/byspace` 当前不存在。
- Wrangler 已登录用户自己的 Cloudflare 账号并具备 Pages 写权限，`byspace` Pages 项目当前不存在。
- npm 当前返回未认证；`byspace` 与 `@bytetrue/byspace` 查询不到现有包，但实际命名与发布权限仍需登录后确认。
- 用户已明确授权创建仓库、推送、发布和 Cloudflare Pages 部署。

## 已确认决策

- 正式显示名 `BySpace`；公开仓库 `ByteTrue/byspace`，首版公开可见。
- 首个版本 `v0.1.0`。
- 用户安装入口只有 `@bytetrue/byspace`；一个 tarball 内嵌 5 个内部 workspace，外部依赖在目标平台正常安装。
- Pages 使用 `byspace.pages.dev`；Relay 使用 `byspace-relay.bytetrue.workers.dev` 和自己的 Durable Object；不设置自定义域名或 upstream proxy。

## 现状如何工作

发布拓扑已经收缩为四条独立但有门禁的链路：`main` CI 通过后部署 Pages 与 Relay；`vX.Y.Z` / `vX.Y.Z-beta.N` tag 触发单包 npm 发布和 GitHub Release；Docker tag workflow 构建可选镜像；Nix hash workflow 在 lockfile 变化后计算并提交正确 hash。首个 npm 版本因包尚不存在，需要一次本机 `npm login` bootstrap，随后改用 `npm-release.yml` 的 OIDC Trusted Publishing。

## 影响范围

- 必须修改：Git remotes、包名与元数据、版本/发布脚本、GitHub workflows、Cloudflare Pages 配置、安装说明。
- 需要验证：全新机器/目录安装 CLI、daemon 启动、Web 连接、release 资产、CI 权限与 secret、Pages 回滚入口。
- 已决定：CLI/daemon 形成一个公开 npm 包，内部 workspace 不作为用户安装入口。

## 方案判断

使用 npm 原生 bundled dependencies 只内嵌 BySpace 内部 runtime packages；不打包外部依赖，避免把构建机的原生二进制错误带到其他平台。发布脚本从 workspace 产物构建临时 staging package，CI 在 Linux/macOS/Windows 空前缀安装并启动隔离 daemon。

## 实现设计

- `scripts/pack-byspace.mjs` 构建 Server/Web，打包并内嵌 highlight/protocol/client/relay/server。
- `scripts/smoke-byspace-package.mjs` 选择临时端口与 home，禁用 relay，轮询 readiness，并 force-stop 验证 cleanup。
- `scripts/publish-byspace.mjs` 只发布已验证 tarball，stable/beta dist-tag 明确。
- CI deployment 通过 `workflow_run` 只消费 `main` 成功 CI 的精确 SHA，并对生产目标加 concurrency。
- npm tag workflow 校验严格 tag 格式；只有 npm 成功或该版本已存在后才创建 GitHub Release。

## 验证

- `npm run release:check` 通过：branding/upstream gate、typecheck、lint、format、package build、clean install、daemon smoke、npm dry-run。
- Tarball 内含 5 个内部 packages，59 个外部 runtime dependencies 无缺失/冲突；外部 native 依赖未从构建机 bundle。
- 空前缀 `byspace --version`、`--help`、daemon start/status/pair/stop 已通过；隔离 home/listen 与自有 pairing endpoints 正确。
- Workflow YAML 解析通过；多轮独立 review 的 packaging/lifecycle/CI blocker 已修复。
- 首次远端 CI 暴露版本重置门禁、旧品牌测试断言、Wrangler exports、Windows npm spawn 与 Web-only 后残留 E2E；均已按根因修复，最新本地 release gate、217 个聚焦测试和此前 CI 硬失败对应的 31 个 Playwright 用例通过。
- 最终 CI `29483121410` 在精确 SHA `855e9ff603bd013087bbb767dcc2634d8a339e3b` 全绿：Linux/macOS/Windows distribution、App/Server/CLI/Relay、4 个 Playwright shards、typecheck/lint/format 均通过。
- Registry 全新安装 `@bytetrue/byspace@0.1.0` 后，version/help 与隔离 daemon start/status/stop 通过；Pages、Relay health、GitHub Release 和双架构 Docker manifest 均在线。

## 执行记录

- 已完成 v0.1.0 metadata、changelog、单包脚本、三平台 CI distribution job、CI-gated Pages/Relay、npm OIDC/tag workflow、Docker tag 验证和 Nix hash bot workflow。
- `ByteTrue/byspace` public repository 已创建并配置 `origin`；Cloudflare Pages `byspace` 与 Worker `byspace-relay` 已在 ByteTrue account 部署。
- GitHub Secret `CLOUDFLARE_API_TOKEN` 只具有目标 account 的 Workers Scripts Edit + Cloudflare Pages Edit，`CLOUDFLARE_DEPLOY_ENABLED=true`；App run `29505394675` 与 Relay run `29505398465` 已通过显式 workflow dispatch 验证部署步骤、凭据和生产资源。自动 `workflow_run` 触发会在下一次 `main` CI 后自然观测。
- 首包 `@bytetrue/byspace@0.1.0` 已从绿灯 CI artifact bootstrap 发布；npm Trusted Publisher 已绑定 `ByteTrue/byspace` + `npm-release.yml`，只允许 `npm publish`。
- `v0.1.0` 指向绿灯 SHA；GitHub Release 与 amd64/arm64 Docker `0.1.0`/`latest` 已发布。首次 tag workflow 因 shallow checkout 无法验证 upstream cursor，Release 由同一 changelog 脚本补建，并为后续发布修复 `fetch-depth: 0`。

## 关闭回写

- Epic / Project Spec：回写正式身份、发布拓扑、安装路径、精确 SHA 门禁、最小凭据约束与实际验证。
- 流程文档：重复发布和回滚操作由 `docs/release.md` 保存；本 issue 只保留首次发布证据。
- Agent 指令与 tools：现有发布规则和脚本已覆盖，不新增重复入口。

## 关闭结论

- 关闭判断：目标已达成。GitHub、npm、Pages、Relay、GitHub Release 和双架构 Docker 均可访问，单包安装与生产 CI/CD 可重复执行。
- 验证摘要：release tag `v0.1.0` 指向最终绿灯 SHA `855e9ff603bd013087bbb767dcc2634d8a339e3b`；CI run `29483121410` 全绿；registry 全新安装验证 version/help 与隔离 daemon start/status/stop；Pages、文档 redirects、Relay health、GitHub Release、Docker manifests 和两条显式 Cloudflare GitHub Actions 部署均在线。
- 回写位置：正式身份、使用路径、发行拓扑、精确 SHA 发布门禁、单包 npm 与最小凭据约束已合并到所属 Epic，并在 Epic 关闭时毕业到 `.cs/spec/index.md` 的“能力地图”“使用路径”“发布”和“关键考量”；重复操作由 `docs/release.md` 承担。
- 遗留事项：`0.1.0` 是人工 bootstrap 发布；下一版本首次通过 OIDC 发布时验证 Trusted Publisher，再把 npm publishing access 收紧为禁止传统 token。Cloudflare 自动 `workflow_run` 触发同样在下一次 `main` CI 后自然验证；这两项不影响当前发布与已验证的显式部署通道。
