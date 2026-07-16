---
kind: issue
title: "完整迁移项目身份到 BySpace"
status: closed
created: 2026-07-15
epic: ".cs/epics/2026/07/14/web-only-byspace/spec.md"
---

# 完整迁移项目身份到 BySpace

## 目标

首次发布前，把活跃项目身份一次性统一为 `BySpace`（显示名）、`byspace`（机器标识）和 `BYSPACE_*`（环境变量），不在代码、包、协议工具、配置、路径和用户文档中长期保留 `Paseo/paseo/PASEO_*` 双命名。

允许保留旧名的范围只有：AGPL/版权与上游归属、Git remote 和历史、历史 changelog/issue 证据，以及解释迁移来源的文档段落。

## 现状如何工作

当前 fork 已完成 Web-only 裁剪，但大多数活跃标识仍继承 upstream：npm workspace 使用 `@bytetrue/byspace-*`，CLI 与 daemon 读取 `PASEO_*`，默认状态和配置使用 `.paseo` / `paseo.json`，协议工具和类型包含 `Paseo/paseo`。只改页面标题会留下两套长期命名，并让发布包、日志、配置和搜索持续混淆。

## 影响范围

### 必须修改

- npm workspace/package/import 名称、CLI binary/help、产品元数据与 UI 文案。
- `PASEO_*` 环境变量、默认状态目录、端口、pid/socket/log/config 路径。
- `paseo.json`、协议/Client/Server/CLI 的公开类型与函数、Agent MCP/扩展工具名。
- 活跃文件和目录名、测试 fixture、workflow、Nix/Docker、README 与 docs。
- Cloudflare Pages/Relay 名称和默认 URL。

### 需要验证

- Provider 和 Pi extension/MCP 注入在工具改名后仍完整工作。
- 旧名清理没有误伤 AGPL 归属、Git history 或第三方项目名。
- npm workspace 依赖图、AOT protocol validation、Nix hash和发布 tarball。
- 配对链接、Relay E2EE、daemon supervision 与 CLI 安装路径。

### 仍待调查

- 上游更新移植后会新增哪些旧名落点；因此本 issue 在 upstream issue 完成后实施。

## 实现设计

### 命名规则

- 用户可见产品名：`BySpace`。
- CLI、仓库、npm、域名、配置文件和小写标识：`byspace`。
- 环境变量：`BYSPACE_*`。
- TypeScript 类型与导出：`BySpace*`。
- npm 内部包：`@bytetrue/byspace-*`；发行入口：`@bytetrue/byspace`。
- 默认状态：`~/.byspace`；默认 daemon：`127.0.0.1:6777`。

### 执行顺序

1. 改 workspace package 名与 imports，重建 lockfile，先恢复 typecheck。
2. 改环境变量、默认目录/端口和配置文件，删除旧名 fallback。
3. 改协议工具、Provider extension、公开类型/函数和对应 tests。
4. `git mv` 活跃文件/目录，修正 import 和脚本路径。
5. 改 UI、CLI、workflow、Nix/Docker、README/docs；历史归属明确保留。
6. 对 tracked 活跃树执行大小写精确残留审计，逐项分类。

## 验证

- `npm run branding:check` 通过；活跃代码、路径、配置、文档和端口只剩精确允许的 upstream/历史证据。
- `npm ci --dry-run`、root typecheck/lint/format、Client/Server builds、Web export、Relay Wrangler dry-run 通过。
- 命名、配置、home/env、supervisor、CLI、协议、App runtime、i18n、Relay 等聚焦测试通过。
- 新 tarball 的空前缀安装与 daemon start/status/pair/stop 留给首次发布 issue，在最终版本和 bundle 脚本落定后执行。
- Pages、Relay、配对链接和 Docker source config 使用 BySpace 自有 endpoint；真实 endpoint 创建/健康验证留给部署 issue。

## 执行记录

- Workspace namespace 已从 `@getpaseo/*` 原子迁移到内部 `@bytetrue/byspace-*`；公开 CLI/daemon 入口为 `@bytetrue/byspace`，lockfile 由 npm 重新生成。
- Runtime 环境变量统一为 `BYSPACE_*`；状态目录为 `~/.byspace`，项目配置为 `byspace.json`，默认 daemon 端口为 `6777`。
- 类型、工具、MCP、Pi extension、storage key、日志/进程/IPC 标识、文件与目录已统一为 `BySpace/byspace`；未保留旧名 runtime alias。
- 删除了遗漏的 CLI desktop/path-open 路径、Electron process env/pid 字段、desktop i18n namespace 与相关测试/文档残留。
- Relay 使用自己的 Workers.dev + Durable Object，不再配置 upstream proxy；Pages project 为 `byspace`。
- 新增 `scripts/check-branding.mjs`，并接入 CI 与 release gate；检查活跃内容、文件名、旧环境前缀、旧端口、公开 package/bin 与可执行位。
- 三轮独立 review 的 blocker 均已处理；最终 typecheck/lint/format/build 与聚焦回归保持绿色。

## 关闭回写

- 命名规则和禁止双命名边界先回写 epic；epic 关闭时毕业到 project spec 与根 Agent 指令。

## 关闭结论

- 关闭判断：活跃项目身份已统一为 `BySpace` / `byspace` / `BYSPACE_*`，没有旧名 runtime alias 或双命名 fallback；允许保留的 Paseo 痕迹只存在于归属、Git/upstream 和历史证据边界。
- 验证摘要：branding gate、root typecheck/lint/format、Client/Server/Web builds、Relay dry-run、聚焦 runtime/CLI/协议测试和最终发行 tarball 均通过；branding gate 已接入 CI 与 release gate。
- 回写位置：统一语言、机器标识、旧名保留边界和 branding 约束已合并到所属 Epic，并在 Epic 关闭时毕业到 `.cs/spec/index.md` 的“统一语言”“当前边界”和“关键考量”。
- 遗留事项：无；后续 upstream 移植继续由 branding gate 阻止旧名重新进入活跃边界。
