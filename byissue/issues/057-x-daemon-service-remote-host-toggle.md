---
kind: issue
title: "Daemon 服务开关放开本机限制：能力门控 + 确认弹层"
type: feature
status: closed
created: 2026-09-28
---

<!-- 读者：跨会话接手的人。目标与范围 · 根因证据 · 现状怎么工作 · 影响面 · 方案 · 验证 · 关闭回写 -->

# Daemon 服务开关放开本机限制：能力门控 + 确认弹层

## 为什么做

Issue 043 交付时把 `DaemonServiceSection` 限定为「本机 daemon 时可见」，判据是 `useIsLocalDaemon`：浏览器 origin === 该主机 directTcp endpoint。这个判据度量的是「你在哪打开网页」，不是「daemon 在哪台机器」——用户主力通过云端 Web（relay）管理本地与远程主机，本机 daemon 从云端打开时开关不可见，功能形同不存在。

机制上没有任何客户端位置约束：服务安装 RPC（`patchDaemonConfig({ service: { install } })`）在目标 daemon 进程内执行，spawn 的是 daemon 所在机器的 launchd/systemd/schtasks；daemon 侧已有 npm -g install-origin 校验与 Docker/dev checkout 的可行动错误文案。043 代码注释里的两条理由（「install 必须在 daemon 自己的进程里带着 install-origin 上下文执行」、远端 Docker 场景）都与客户端位置无关，不成立。

**拍板（用户，2026-09-28）：** 放开为能力门控；切换加确认弹层兜住误触与「服务定义错误导致远程通道断开」的锁死风险。取代 043 的「本机 daemon 时可见」范围声明（043 文件同步改名 `-o-` → `-x-` 归档）。

## 做成以后是什么样

- 任何主机页，只要 daemon 自报 `features.daemonServiceInstall` 就显示服务开关；老 daemon（< v0.14.7）仍然隐藏，不做假成功。
- 开关切换（install / uninstall）先弹 `confirmDialog` 确认（沿用 restart 卡的既有模式），确认后才走 `patchDaemonConfig`；取消不动。
- `useIsLocalDaemon` 不再参与该分区渲染；同页 `UpdateDaemonCard`（仅远端）、移除主机等行为不变。

## 动哪些、验哪些

- `packages/app/src/screens/settings/host-page.tsx`：去掉 `DaemonServiceSection` 外层的 `isLocalDaemon` 条件。
- `packages/app/src/screens/settings/daemon-service-section.tsx`：`handleToggle` 前置确认弹层；更新文件头注释（043 的注释声称 remote hosts 不显示，已失效）。
- `packages/app/src/i18n/resources/*.ts`（9 locale）：`service.confirmInstallTitle/confirmInstallMessage/confirmUninstallTitle/confirmUninstallMessage/confirmInstall/confirmUninstall`。
- 验证：i18n key 对齐测试、typecheck、lint、format；本机 Web 回归（开关仍显示、确认后生效）；云端 Web（relay origin）下主机页开关出现。

## 制度记忆影响

- 043 的范围声明被本 issue 取代；043 已改名归档，历史记录保留不改写。
- `byissue/spec/` 无该事实记录，无需回写；若后续把「服务托管」写进 spec/connection.md，一并按新语义写。

## 执行记录

### 2026-09-28 · 实现与静态验证

- **`host-page.tsx`**：`DaemonServiceSection` 去掉 `isLocalDaemon` 外层条件，任何主机页都挂载（能力门控在 section 内部：`serviceFeature !== true` → 不渲染）。`isLocalDaemon` 仍被同页 `UpdateDaemonCard`（仅远端）与 `RemoveHostSection` 使用，保留。
- **`daemon-service-section.tsx`**：`handleToggle` 前置 `confirmDialog`（沿用 restart 卡模式），install/uninstall 各自的标题/描述/按钮文案，取消不动；更新文件头注释（043 的「remote hosts never show this switch」已失效，issue 057 取代）。
- **i18n**：9 locale 各加 6 个 `service.confirm*` 键。
- **验证**：i18n 资源 + key 对齐测试 36 个全绿（`npx vitest run packages/app/src/i18n/resources.test.ts packages/app/src/i18n/key-contract.test.ts`）；`npm run typecheck` 通过（先 `npm run build:client` 重建了 protocol 的过期声明——typecheck 曾因 issue 052 的 `findTerminalProfileForProvider` 报错，与本次改动无关）；对 11 个改动文件 lint 0 警告、format 完成。
- **浏览器验证（dev daemon 6778 + dev Metro 8081，agent-browser）**：origin 用 `http://127.0.0.1:8081`（≠ daemon endpoint，等价云端/relay origin 的「非本机判定」场景）——修复前此场景必然隐藏。结果：
  - Overview 页出现「Service hosting / Start at login」区块与开关（能力门控通过，v0.16.4 dev daemon）。
  - 点开关 → `confirmDialog` 弹出，文案正确（"Enable service hosting? …"）；取消 → 开关保持关、无错误。
  - 接受 → dev daemon 跑在仓库 checkout（非 npm -g），origin 校验拒绝并在区块内显示可行动错误（"not installed with npm -g on this host"），状态仍如实报 not-installed——拒绝路径与错误展示同轮验证。
- 环境坑（记 fast 排查成本）：`agent-browser`/Chrome 连 `localhost:8081` 报 10060 而 curl 正常，`127.0.0.1:8081` 正常——hosts/IPv6 解析差异，与代理无关；Metro 对 `192.168.1.103` 的绑定不可达。均不影响结论。

### 2026-09-28 · 关闭

用户验收通过后授权关闭。目标达成：服务开关可见性只由能力门控决定，云端/relay 下本机 daemon 的开关可操作；确认弹层、i18n、拒绝路径均验证。范围未扩。毕业回写检查：可见性规则可从代码重建（能力门控 + `host-page` 挂载），不进 project spec；058 承接的同类判定问题在彼处记录。无有界简化遗留。
