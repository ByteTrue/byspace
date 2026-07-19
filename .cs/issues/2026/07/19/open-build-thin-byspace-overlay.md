---
kind: issue
title: "实现 BySpace 薄发行 overlay"
type: feature
status: open
created: 2026-07-19
epic: ".cs/epics/2026/07/19/upstream-thin-distribution/spec.md"
---

# 实现 BySpace 薄发行 overlay

## 目标

在精确 upstream beta 基线上，以少量、独立、可删除的 patch 提供用户可观察的 BySpace Web/PWA 与 `byspace` CLI、自托管 Pages/Relay，以及 Pi `max` thinking；内部继续保持 upstream package、协议、环境变量和源码身份。

## 范围

- 包含：Pi max、Web/PWA 品牌、薄 `@bytetrue/byspace` npm artifact、ByteTrue Cloudflare 配置/工作流、全局 mise Node 规则、README/downstream 说明、必要测试。
- 不包含：内部 `Paseo` 全量改名、删除 upstream 平台源码、旧状态迁移、Hub、post-beta upstream commits、production 部署或发布。

## 归属

- 隶属 epic：`.cs/epics/2026/07/19/upstream-thin-distribution/spec.md`
- 相关 spec：`.cs/spec/index.md`

## 背景与证据

- beta.1 和当前 upstream main 的 Pi adapter 只接受到 `xhigh`，但本机 Pi 0.80.10 CLI 已公开支持 `max`。
- App 的 model/thinking 通路是通用 option 模型，Pi max 不需要改 protocol/client/App。
- upstream `@getpaseo/cli@0.2.0-beta.1` 及其 server/client/protocol 包已经发布到 npm，可以成为薄发行物的精确依赖。
- 当前单包 bundling 是 fork-specific 复杂度与历史安装故障来源，新发行物不再内嵌 runtime workspaces。

## 现状如何工作

upstream Web 从 app config、PWA manifest、HTML metadata 和 i18n resources 展示 Paseo；CLI/server 通过正常多包 npm 依赖运行，并读取 `PASEO_*` 与 `~/.paseo`。Pi provider 把 catalog thinking options映射到 generic Agent model，但本地 union、catalog 和 validator 会过滤 `max`。

## 影响范围

- 必须修改：Pi adapter 类型/catalog/validator；Web brand overlay；独立 npm packaging/wrapper；Pages/Relay deployment overlay；downstream docs/config。
- 需要验证：upstream package 精确版本安装、CLI signal/exit forwarding、daemon home/listen/relay env、所有 locale 的用户可见品牌、PWA metadata、Relay 无 upstream proxy、Pi create/set/import behavior。
- 仍待调查：wrapper 的最小进程转发实现以实际 upstream CLI package layout 为准；不得为此恢复内部 bundling。

## 质量目标

- **可维护性 / 模块化与可修改性**：
  - 目标：每项 downstream 行为是一笔单一职责 commit；未来 upstream 正式版更新时可独立重放或删除，且产品代码不出现全仓 rename/prune。
  - 来源：Epic。
  - 预期证据：base..HEAD commit ledger、diff stat、独立 review。
- **功能适宜性 / 正确性**：
  - 目标：用户在 Web 和命令入口看到 BySpace；选择 Pi max 后 daemon 原样向 Pi 传递 `max`，而非回落 medium。
  - 来源：用户决定。
  - 预期证据：Pi focused tests、Web rendering/PWA检查、CLI smoke。
- **兼容性 / 互操作性**：
  - 目标：`@bytetrue/byspace@0.2.0-beta.1` 的所有 `@getpaseo/*` runtime 依赖固定为 `0.2.0-beta.1`；安装树无 invalid/missing/empty stub。
  - 来源：Epic 与历史 npm 故障。
  - 预期证据：clean-prefix global install、`npm ls --all`、native module load、isolated daemon smoke。
- **信息安全性 / 完整性**：
  - 目标：生产 Relay 只使用 ByteTrue Durable Object，不转发 Paseo/Fly upstream；凭据不进入仓库。
  - 来源：Project Spec 与 Epic。
  - 预期证据：Wrangler dry run/config review、部署 E2E。
- **交互能力 / 适当性可识别**：
  - 目标：受支持的 Web shell、PWA install metadata 和命令入口一致使用 BySpace；内部技术标识可以显示 Paseo，但不能让主要入口名称混乱。
  - 来源：用户接受的外部品牌边界。
  - 预期证据：Web export检查、CLI `--help`/`--version` 和 onboarding smoke。

## 方案判断

不修改 upstream 内部 namespace。Web 品牌集中在渲染/metadata 层，避免机械改写各语言资源；CLI 发行从 upstream CLI 构建结果生成独立薄 tarball，依赖正常发布的 upstream packages。Pi max 只扩展 provider-owned枚举、catalog 与 validator。部署差异放在单独 config/workflow，而不是改 daemon 默认协议和环境变量。

## 实现设计

### 这次要怎么做

把 overlay 分成可按顺序重放的六笔：downstream metadata、Pi max、Web brand、thin npm CLI、Cloudflare self-host、release docs/Node policy。每笔只使用 upstream 已存在的接缝，避免重新创造一个 BySpace 平行架构。

### 功能怎么分工

- Pi provider 自己拥有 thinking level 的 runtime truth 和 catalog。
- Web app 的 i18n 初始化与静态 metadata 负责外部显示名；logo可先沿用，不引入视觉重设计。
- distribution wrapper 只负责 `byspace` 命令、BySpace 默认 home/listen/app/relay env 和启动 upstream CLI；业务命令仍由 upstream CLI/server 实现。
- Cloudflare overlay 只负责账户、项目、Worker、Durable Object 和触发规则。

### 请求 / 数据怎么走

用户运行 `byspace` 后，wrapper 设置未由用户覆盖的 `PASEO_*` 默认值，再将 argv/stdin/stdout/stderr/signals 交给同版本 upstream CLI。CLI 启动同版本 upstream server；pairing offer携带 ByteTrue Relay 与 BySpace Web URL。Web 与 daemon 继续说 upstream protocol。Pi max 从 generic `thinkingOptionId` 到 Pi adapter，再成为 `--thinking max` 或 RPC `set_thinking_level`。

### 哪些边界不碰

不改 `@getpaseo/*` 名称、`PASEO_*`、`paseo.json`、upstream storage/schema、Desktop/native/Browser/website 源码。不复制 upstream CLI 业务代码到 wrapper；不把依赖重新 bundle 进 tarball。不连接 Paseo Hub 或 upstream Relay。

### 质量目标如何落实

Patch queue 的 commit边界支撑可维护性；精确依赖和 clean install 支撑互操作性；provider级 regression支撑 max 正确性；Web/CLI真实运行检查支撑外部品牌；独立 Wrangler config 与 dry run支撑 Relay完整性。

### 一步步怎么改

1. 在 Pi provider 加 `max`、补 catalog/set/import focused tests。
2. 添加 Web product display overlay和 metadata tests，保持技术标识不变。
3. 新建隔离 distribution package/pack/smoke，使用 upstream normal dependencies。
4. 添加 BySpace Pages/Relay workflows/config，禁用 BySpace 不发布的 upstream release deploy路径。
5. 添加最小 downstream docs与全局 Node policy。
6. 逐 commit跑 focused gate，最后做完整 diff review。

### 怎么确认做对

- Pi：catalog包含 max，create/set/import原样保留。
- npm：空 prefix global install，dependency tree完整，`byspace --version/help`和随机端口 daemon start/status/stop通过。
- Web：真实 export，title/manifest/可见主路径显示 BySpace。
- Relay：Wrangler dry run与本地/测试 relay连接，不存在 upstream proxy var。
- 静态：typecheck、lint、format、diff-check；独立只读 review无 blocker。

## 验证

- 待执行。

## 执行记录

- 待执行。

## 关闭回写

- epic spec：记录最终 patch queue和实际文件/验证。
- project spec：Epic 关闭时再改变当前架构事实。
- notes：如发现 upstream package/wrapper特殊安装约束，沉淀可复用说明。
- AGENTS.md / CLAUDE.md：只保留薄下游必须知道的短规则。
- tools：按实际需要决定，不预建同步脚手架。
