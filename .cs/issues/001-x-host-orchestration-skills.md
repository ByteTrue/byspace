---
kind: issue
title: "Host-scoped orchestration skills management"
type: feature
status: done
created: 2026-07-22
epic: ""
---

# Host-scoped orchestration skills management

## 目标

用户可从 Web 管理任意已连接 Host 上的 BySpace 编排 Skills：查看未安装/最新/有更新状态，并执行安装、更新和卸载。操作发生在目标 Host 的 daemon 机器，不依赖浏览器文件系统。

## 范围

- 包含：随 daemon npm 包分发 `skills/byspace*`；Host-scoped 状态与变更 RPC；Web Host 设置入口；安装到 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills`；清理已删除桌面 Integrations 的路由、文案和样式残留。
- 不包含：任意第三方 Skill 市场、上传自定义 Skill、自动安装/自动更新、CLI 安装管理、Provider 启动后自动 reload。

## 归属

- 独立 issue。
- 相关 spec：`.cs/spec/index.md`；Web-only 产品边界不变，文件系统副作用归 daemon。

## 背景与证据

- 上游桌面版曾由 Electron `integrations-manager` 直接写用户目录；Web-only 清理提交 `2fa0b387a` 删除了 UI、hooks 和安装实现。
- 当前仓库仍有 `skills/byspace*` 源文件、Skill 运行时识别能力和 Integrations 翻译/route slug，但发布包不包含 Skills，Web 无管理入口。

## 现状如何工作

已手动安装的 Skills 能被各 Provider 发现并用于补全；BySpace 自身没有将仓库中的编排 Skills 分发到 daemon 主机的发布资源、RPC 或 UI。

## 影响范围

- 必须修改：协议、client facade、daemon session/资源打包、Host 设置 UI、发布打包测试。
- 已验证：状态差异检测、幂等安装/更新/卸载、非托管同名目录保护、已修改托管副本保护、旧 daemon capability gate、RPC 成功/失败结算、npm tarball 与全局安装包包含资源。

## UI 变化

- 角色与入口：用户在 Settings → Host → Agents 页面管理该 daemon 机器的编排 Skills。
- 图示状态：目标。

```text
┌─ Host / Agents ─────────────────────────────────┐
│ Agent orchestration                              │
│                                                 │
│ Orchestration skills                            │
│ Install five bundled BySpace skills             │
│                                  [Install]      │
│                                                 │
│ 状态变化：Loading → Not installed / Installed  │
│                    Update available / Error     │
└─────────────────────────────────────────────────┘
```

- 交互与关键状态：请求中禁用重复动作；更新和卸载先确认；失败以内联错误留在同一上下文；旧 daemon 显示“Update the host to use this”。
- 稳定约束：入口和状态属于具体 Host；Direct 与 Relay 行为一致；无能力时不走 fallback。
- 仅作示意：文案和卡片内部像素布局沿用现有 Settings 样式。

## 质量目标

- 功能适宜性：安装/更新后三个目标目录与随包资源一致；非托管同名目录不覆盖，已修改托管副本不卸载；以真实临时文件系统测试验证。
- 兼容性：新客户端面对旧 daemon 只显示升级提示；新 RPC 使用 dotted namespace，schema 仅追加可选 feature flag；以协议/typecheck 和 capability 分支验证。
- 可靠性：重复安装/更新/卸载幂等，失败不会被 UI 隐藏；以 service 单测与 UI 可观察状态验证。
- 信息安全性：浏览器不能提交路径或 Skill 名称，daemon 只操作内置白名单及固定 home 子目录；以无用户路径输入的 RPC schema 和文件操作测试验证。
- 可维护性：根目录 `skills/` 是内容单一来源，构建确定性复制到 daemon 包；以 pack 测试验证。

## 方案判断

把原 Electron 本地能力移到 daemon，而不是恢复客户端文件操作。协议采用 `daemon.orchestration_skills.get_status.request/response` 与 `daemon.orchestration_skills.set_installed.request/response`；`installed: true` 同时覆盖首次安装和重新同步更新，减少 RPC 表面积。Wire 只返回稳定状态，差异操作留在 daemon 内部。

不自动更新：首次安装只创建缺失目录或接管内容完全一致的副本；非托管同名冲突会拒绝覆盖。显式更新只替换 manifest 证明由 BySpace 管理的副本；卸载遇到本地修改会拒绝删除。第三方 Skill 不在白名单中，永不修改。

## 实现设计

### 这次要怎么做

构建时把根 `skills/` 复制到 server `dist/skills`。daemon 深模块负责资源定位、内容哈希、所有权 manifest、状态差异、串行变更与三个固定目标目录的整目录替换；session 只做 RPC 转发。Web 通过目标 Host 的 client 调用 RPC，在 Agents 页面呈现状态和动作。

### 请求 / 数据怎么走

Web Host / Agents 页面 → 对应 `serverId` 的 runtime client → correlated RPC → daemon orchestration-skills service → daemon 主机 home 目录 → 返回最新状态 → UI 刷新。

### 哪些边界不碰

- 不接受客户端路径、Skill 名称或文件内容。
- 不修改非 BySpace Skill 目录。
- 不模拟旧 daemon fallback。
- 不重启 daemon 或 Provider；已运行 Agent 何时重新加载 Skill 维持现有 Provider 行为。

### 一步步怎么改

1. 补 daemon service 和真实文件系统测试。
2. 补协议、feature flag、session handler、client methods。
3. 补 server 构建复制与 pack 断言。
4. 在 Host 页面接 UI，覆盖 capability/loading/success/failure/confirm 状态。
5. 删除 app-level Integrations 幽灵 slug、sidebar metadata、翻译与无用样式。

### 怎么确认做对

运行新增 service 测试、相关 protocol/client/server/app 测试、pack 测试；随后运行全仓 typecheck、lint、format，并对 Host 页面做真实 Web 路径检查。

## 验证

- `npx vitest run packages/server/src/server/orchestration-skills.test.ts --bail=1`：6/6 通过。
- `npx vitest run packages/app/src/i18n/resources.test.ts --bail=1`：29/29 通过。
- `npx vitest run packages/app/src/utils/host-routes.test.ts --bail=1`：39/39 通过。
- `npm run test:e2e --workspace=@bytetrue/byspace-app -- settings-navigation.spec.ts --grep "host Agents exposes orchestration skill management"`：1/1 通过；真实 isolated daemon 收到并返回 status RPC。
- `npm run smoke:package`：通过；临时全局安装包包含五个 bundled Skills，CLI/daemon smoke 通过。
- `npm run build:web --workspace=@bytetrue/byspace-app`、`npm run typecheck`、`npm run lint`：通过。
- `npm pack ./packages/server --dry-run --json`：确认 `dist/skills/byspace*` 五项进入 server tarball。
- 独立 reviewer 两轮检查：确认顶层 `rpc_error` 会结算失败请求；修复 Host 切换过期请求、确认并发与目录回滚路径后，无剩余 blocker。

## 执行记录

- 2026-07-22：完成现状检索与方案锁定。
- 2026-07-22：实现 daemon-owned 资源、ownership manifest、真实文件系统测试、向后兼容 RPC 与 Host capability。
- 2026-07-22：在 Host / Agents 接入安装、更新、卸载、确认、内联错误与旧 Host 升级提示；清除 Integrations slug/sidebar/i18n/test 残留。
- 2026-07-22：完成 package smoke、Web export、真实 Web E2E、typecheck、lint 与独立 review；关闭 issue。

## 关闭回写

- project spec：无需改动；现有 Web + daemon 边界已覆盖，本 issue 记录具体能力。
- notes：资源固定在 server `dist/skills`；所有权记录位于目标 daemon 的 `$BYSPACE_HOME/managed-orchestration-skills.json`。
