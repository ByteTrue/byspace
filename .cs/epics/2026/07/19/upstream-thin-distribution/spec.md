---
kind: epic
title: "以 Paseo 0.2.0-beta.1 重建 BySpace 薄发行版"
status: active
created: 2026-07-19
---

# 以 Paseo 0.2.0-beta.1 重建 BySpace 薄发行版

## 这个 Epic 要改变什么

把 BySpace 从大量删除、全仓重命名、逐 commit 移植的深分叉，重建为直接跟踪 Paseo 正式版本的薄下游发行版。新的主线以 upstream `v0.2.0-beta.1` 的精确 commit `0bec06c2db7d3ee071416cde80229eabd682b03e` 为基线，只保留外部 BySpace 品牌、自托管部署、薄 npm/CLI 包装、全局 mise Node 环境和 Pi `max` thinking 支持。

生产切换直接使用 beta.1，不迁移旧运行状态。现有 Git 主线与 `~/.byspace` 必须先独立归档，作为可验证的回滚来源。

## 为什么现在做

当前 BySpace 与 upstream 已形成 1,905 文件的树差异，并同时承担平台裁剪、内部身份迁移、单包打包和频繁 upstream replay。维护成本已经高于当前独有产品行为的价值。用户当前没有需要永久深分叉的产品需求，唯一明确的 Provider 差异是 Pi `max` thinking；因此现在应把可维护性恢复为主约束，而不是继续优化同步流程本身。

## 关联 Project Spec

- `.cs/spec/index.md`：本 Epic 将改变“选择性逐 commit upstream 维护”“Web-only 物理裁剪”“全内部 BySpace 身份”“单包内嵌 runtime”这些当前事实；local-first、Web/CLI/Relay 使用路径和 Pi-first 目标继续成立。

## 当前方案

建立一条与当前 `main` 隔离的新 tracking branch。它保留 upstream 完整仓库、内部 package namespace、协议类型、环境变量、配置名和所有平台源码，不再通过删除和内部改名表达发行边界。BySpace 的差异集中在独立、可排序的 patch queue：

1. Pi adapter 接受并显示 `max` thinking；
2. Web/PWA 用户可见品牌显示 BySpace；
3. `@bytetrue/byspace` 作为薄 CLI 发行物，运行 upstream CLI/server 依赖，不再内嵌五个 workspace；
4. Cloudflare Pages/Relay 和 GitHub Actions 使用 ByteTrue 自托管目标；
5. 仓库不 pin Node，使用操作者当前全局 mise Node；
6. README 与下游维护文档说明 BySpace 是 Paseo 的薄自托管发行版。

本次从 beta.1 直接切生产。旧 `~/.byspace` 不交给 beta daemon 读取；cutover 时改名归档，再创建全新运行 home。后续不跟逐 commit upstream，只有正式版本或明确的紧急安全/Provider 修复进入更新批次。

## 需求变化

- 用户仍通过 `byspace` 命令、BySpace Web/PWA、BySpace Pages 域名和 BySpace Relay 使用产品。
- 内部实现与维护语言恢复为 upstream 的 `Paseo`、`@getpaseo/*`、`PASEO_*`、`paseo.json`；这些不是需要清除的品牌残留。
- Desktop、native、Browser、website 源码可以存在，但 BySpace 的生产发布仍只交付 Web/PWA、CLI/daemon、Relay 和可选 Docker。
- npm 包从内嵌 runtime 的大 tarball 变为依赖精确同版本 `@getpaseo/*` 包的薄发行物。
- upstream 更新节奏从逐 commit replay 改为正式 release rebase。

## 架构考量

- **不用文件覆盖。** 新主线直接以 upstream commit 为 Git 基线；当前深分叉通过 archive branch/tag 保留。这样未来版本更新是小 patch queue 的重放，而不是重新比较两个树快照。
- **不再内部重命名。** 内部身份改名会横跨协议、持久化、包、环境变量和测试，是上一轮同步地狱的主要来源。外部品牌由 Web 渲染层、CLI 发行层和部署层承担。
- **不再物理裁剪。** 不发布某个平台不要求删除其源码。发行 workflow 决定 BySpace 交付什么，upstream 保持什么由 upstream 自己维护。
- **正常使用 upstream 多包发行。** `@bytetrue/byspace` 只包装 upstream CLI，运行依赖由 npm 正常解析；不再依赖手工 bundleDependencies staging。
- **Pi max 是唯一 Provider 代码差异。** 通用 thinking-option 通路已经存在，只扩展 Pi adapter 的允许值、catalog 和回归测试。
- **危险切换后置。** 新分支全部验证通过前不改写 `main`、不覆盖 Cloudflare、不停止当前 daemon；实际 cutover 前再次向用户展示精确操作与回滚点。

## 质量约束与取舍

- **可维护性 / 可修改性**：
  - 约束：产品代码差异只能以少量、单一职责 patch 存在；禁止恢复内部全仓品牌迁移和平台删除。
  - 取舍：upstream 内部和技术输出继续出现 Paseo 名称，以换取直接跟踪正式版本的能力。
  - 继承：所有实现 issue 必须说明新增 patch 的删除条件和 upstream 更新时的重放边界。
- **可靠性 / 可恢复性**：
  - 约束：当前 Git 主线、npm 0.1.1、Cloudflare 部署和 `~/.byspace` 在生产切换前都有明确备份；任何 cutover 步骤失败可恢复到旧 daemon 与旧部署。
  - 取舍：不做旧状态兼容迁移；生产从 fresh home 开始。
  - 继承：发布和 cutover issue 必须验证回滚路径，而不只是新版本 happy path。
- **兼容性 / 互操作性**：
  - 约束：薄 npm 包必须固定匹配的 upstream beta/stable 版本，禁止 CLI/server/protocol 混用不同 release。
  - 取舍：BySpace 自己不承诺跨 upstream release 的旧 daemon/client 兼容；跟随 upstream 自身契约。
- **信息安全性**：
  - 约束：Relay 继续由 ByteTrue Cloudflare Durable Object 自托管，不配置 upstream proxy；CI token 只使用既有最小权限。
- **交互能力 / 适当性可识别**：
  - 约束：受支持的 Web/PWA shell、PWA manifest、命令入口和部署入口显示 BySpace；技术配置、内部 namespace 与 upstream 文档可保留 Paseo。

## 统一语言

- **upstream baseline**：某个 Paseo 正式 tag 或本次明确批准的 beta tag 对应的精确 commit。
- **thin overlay**：不改变 upstream 内部架构、只承载外部品牌、部署、发行和明确 Provider 差异的下游 patch 集。
- **production cutover**：在新分支验证完成后，归档旧主线和运行状态、切换 GitHub `main`、Cloudflare 与本机 daemon 的危险操作。
- **external BySpace identity**：`BySpace` 显示名、`byspace` 命令/npm/域名/部署；不包含内部源码标识全面改名。

## 当前推进

### 可推进范围

- 冻结 beta.1 基线并建立 archive/tracking 分支。
- 实现、测试薄 overlay，所有工作保持在隔离 worktree。
- 构建 beta npm artifact、Web export、Relay dry run 和跨层 focused tests。

### Issues

- [ ] `.cs/issues/2026/07/19/open-establish-upstream-beta-baseline.md`：归档当前主线并建立精确 beta tracking branch。
- [ ] `.cs/issues/2026/07/19/open-build-thin-byspace-overlay.md`：实现 Pi max、外部品牌、薄 CLI/npm 和自托管部署 overlay。
- [ ] `.cs/issues/2026/07/19/open-verify-byspace-beta-release.md`：验证 release artifact、Web/Relay 和完整 patch queue。
- [ ] `.cs/issues/2026/07/19/open-cut-over-byspace-beta-production.md`：经再次确认后改写 main、部署并切换本机生产 daemon。

### 剩余阻碍

- production cutover 必须等前三个 issue 全部通过，并在执行危险操作前再次得到用户确认。

## 暂不推进范围

- 逐 commit 吸收 beta.1 之后的 upstream main 更新。
- Paseo Hub。
- 内部 namespace、协议、环境变量、配置文件和源码路径的 BySpace 重命名。
- 删除 upstream Desktop/native/Browser/website 源码。
- 迁移旧 `~/.byspace` agents/projects/workspaces 到 beta 数据模型。
- 在 upstream 正式支持前扩大 Pi 之外的 Provider 差异。

## 未确认问题

- 无阻塞性产品问题；实际 cutover 的精确 Git ref、home 备份名和 Cloudflare deployment SHA 将在前三个 issue 完成后生成并再次确认。

## 关闭条件

- 新 `main` 以精确 upstream release commit 为祖先，只含审阅过的薄 overlay commits。
- `@bytetrue/byspace@0.2.0-beta.1` 可从干净 prefix 安装，`byspace` 能启动、检查和停止 daemon，且依赖使用精确同版本 upstream packages。
- Web/PWA 对外显示 BySpace，Pages/Relay 部署到 ByteTrue 目标，Relay 不代理 upstream。
- Pi catalog 可选择 `max`，创建和运行时原样传给 Pi，并有回归测试。
- 当前 Git/Cloudflare/npm/home 均有回滚点；production cutover 验证通过。
- 用户明确确认 Epic 关闭后，稳定结论才合并回 Project Spec。

## 合并回 Project Spec 的候选

- BySpace 是 Paseo 的薄、自托管、Pi-first 下游发行版。
- upstream 只按正式 release 更新；内部保持 upstream identity 和完整源码面。
- 外部品牌、薄 npm wrapper、自托管部署与 Pi max 构成长期 patch queue。
- npm 发行恢复为依赖 upstream 多包发布，而不是内嵌内部 workspaces。

## 关闭回写

- 状态：关闭时改为 `closed`。
- 合并位置：`.cs/spec/index.md`。
- Vision 同步：无来源 Vision；关闭时说明不需同步。
- 保留材料：旧 Web-only fork 与逐 commit sync 历史继续留在其已关闭 epic/issues 和 archive branch。
