---
kind: issue
title: "支持按需选择编排 Skill 与安装目标环境"
type: feature
status: closed
created: 2026-08-21
---

# 支持按需选择编排 Skill 与安装目标环境

## 目标

在 Web 设置的「编排 Skills（Orchestration skills）」卡片中，用户不仅能够一键安装全部 Skill 到所有环境，还可以：

1. 按需勾选想要安装的具体 Skill（`byspace`, `byspace-advisor`, `byspace-committee`, `byspace-handoff`, `byspace-project-setup`）。
2. 选择想要安装的目标环境目录（`~/.agents/skills` 与 `~/.claude/skills`）。
3. 保持前后向协议兼容，更新或卸载时能够安全管理已托管与未选中的 Skill 副本。

## 范围

- 包含：
  - `packages/protocol`：扩展 `DaemonOrchestrationSkillsGetStatusResponse` 与 `DaemonOrchestrationSkillsSetInstalledRequest`，包含 `skills` 细粒度状态以及可选的 `skillNames` 与 `targets` 字段。
  - `packages/server`：在 `orchestration-skills.ts` 中支持按 Skill 和目标环境（`agents` / `claude`）进行状态检测、选择性安装/更新、自动清理不再选中的已托管副本，以及单元测试覆盖。
  - `packages/client`：在 `daemon-client.ts` 中支持传递选择性参数。
  - `packages/app`：在 `OrchestrationSkillsCard` 中提供配置弹窗/展开选择器，展示各目标环境（`~/.agents`、`~/.claude`）及各 Skill 项，支持勾选/反选与选择性保存。
- 不包含：
  - 上传任意第三方 Skill。

## 方案与设计

- 协议契约：
  - `daemon.orchestration_skills.get_status.response` 返回顶层 `state` 以及可选的 `skills: OrchestrationSkillItemState[]`、`installedTargets: ("agents" | "claude")[]`。
  - `daemon.orchestration_skills.set_installed.request` 接受 `installed: boolean`、可选 `skillNames?: string[]`、可选 `targets?: ("agents" | "claude")[]`。
  - 省略字段时保持旧版全装/全卸默认行为。
- Daemon 状态与变更管理：
  - `manifest.managed` 记录每个目标文件的 digest。
  - 当指定 `skillNames` 和 `targets` 时，仅将选中的 Skill 同步到选中的目标目录；若之前由 BySpace 托管但在本次取消选中的 Skill 副本，安全移除并从 manifest 清除。
- UI 交互：
  - 卡片展示当前安装状态概览（已安装数量、目标环境）。
  - 点击「安装」/「管理 / 安装」或「更新」弹出配置 Sheet/对话框，包含目标环境多选（`~/.agents`、`~/.claude`）与 Skill 列表多选。
  - 提供快速全选/全不选以及直接提交保存。

## 计划步骤

1. 协议与类型定义：在 `packages/protocol` 中添加相关 schema 和类型，重新生成 validators。
2. Server 端实现：在 `packages/server/src/server/orchestration-skills.ts` 和 `daemon-session.ts` 中实现选择性安装与状态探测，完善测试。
3. Client 端适配：在 `packages/client/src/daemon-client.ts` 中更新方法签名。
4. UI 端实现：在 `packages/app/src/screens/settings/host-page.tsx` 中实现选择性配置 Sheet/Dialog 与交互，并添加多语言文案。
5. 全流程验证：单测、typecheck、lint、format。

## 验证结果

- `npx vitest run packages/server/src/server/orchestration-skills.test.ts packages/app/src/screens/settings/orchestration-skills-modal.test.tsx packages/app/src/hosts/appearance.test.ts packages/app/src/components/ui/combobox-frame-style.test.ts packages/app/src/git/actions-store.test.ts --bail=1`：5 个测试文件，40/40 测试全部通过。
- `npm run build:server`：打包并构建通过。
- `npm run typecheck`：全 workspace 0 错误通过。
- `npm run lint`：0 warning 0 error。
- `npm run format`：通过。
