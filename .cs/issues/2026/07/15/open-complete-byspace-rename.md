---
kind: issue
title: "完整迁移项目身份到 BySpace"
status: open
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

- 活跃代码与配置的 `Paseo|paseo|PASEO_` 搜索只剩允许清单。
- `npm ci`、typecheck、lint、format、Web/server/CLI/relay builds 通过。
- Protocol/Client/Server/CLI/Provider/Pi 受影响测试通过。
- 新 tarball 在空前缀安装后 `byspace --version/help`、daemon start/status/pair/stop 通过。
- Pages、Relay 和配对链接使用 BySpace 自有 endpoint。

## 执行记录

待 upstream 更新审阅与移植后执行。

## 关闭回写

- 命名规则和禁止双命名边界先回写 epic；epic 关闭时毕业到 project spec 与根 Agent 指令。
