---
kind: issue
title: "多 Host 聚合 Project 移除选择与 New Workspace 项目优先联动"
type: ff
status: closed
created: 2026-09-15
---

<!-- 快改痕迹：轻。读者只要 30 秒扫完。禁止迷你 Design。 -->

# 多 Host 聚合 Project 移除选择与 New Workspace 项目优先联动

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `codestable/` 有无影响。

---

修复并优化了多 Host 协同场景下的两处关键体验痛点：

1. **多 Host 聚合项目的 Remove 交互**：当多个设备（如办公机与家庭机）添加同一个 Git Project 时，原先侧边栏点击 Remove 会无差别同时向全部 Host 发送移除请求，且其中任一 Host 离线会直接报错阻断。现在引入 `ProjectRemoveModal`：
   - 单 Host 项目保留原有的直接确认对话框；
   - 多 Host 聚合项目弹出自适应选择模态框，列出该项目实际关联的各个设备及在线状态，支持「仅从指定设备移除」或「从全部设备移除」，保留其他设备上的项目与工作区。
   - `project-remove.ts` 支持针对特定 targets 子集进行校验与执行。

2. **New Workspace 交互心智纠正为「Project 优先」**：原先逻辑倒置（以 Host 为核心过滤 Project，Host 永远展示全局列表而 Project 列表跟着切）。现纠正为开发者自然心智：
   - Project 选择器展示全部已添加的项目，不受当前 Host 过滤；
   - Host 候选池由已选中的 Project 动态收敛（`availableHosts`）：
     - 当 Project 仅在 1 台机器上存在时，自动选定该机器并**直接隐藏 Host 选择器**；
     - 当 Project 存在于多台机器时，HostPicker **仅展示拥有该项目的机器**（未添加该项目的机器不出现）；
     - 切换到新项目时，若当前 Host 不支持该项目，自动无缝切换到目标机器。

- 改动文件：
  - `packages/app/src/projects/project-remove.ts` — 新增 `getProjectRemoveReadinessForTargets` / `getCurrentProjectRemoveReadinessForTargets`。
  - `packages/app/src/projects/project-remove-modal.tsx` — 新增多 Host 移除确认与选择弹窗组件。
  - `packages/app/src/projects/host-project-model.ts`、`packages/app/src/projects/host-projects.ts` — 导出 `resolveInitialProject`，跨 Host 解析首选项目。
  - `packages/app/src/screens/new-workspace/project-picker.ts` — `selectableProjects` 对全部项目开放，不再被 `selectedServerId` 预先裁剪。
  - `packages/app/src/screens/new-workspace/project-selection.ts` — 保持用户手动选择跨 Host 项目的准确性。
  - `packages/app/src/screens/new-workspace-screen.tsx` — Host 列表基于 `selectedProject.hosts` 动态过滤与自动校准。
  - `packages/app/src/components/sidebar-workspace-list.tsx` — 接入 `ProjectRemoveModal`。
  - `packages/app/src/i18n/resources/*.ts` — 9 种语言补充多宿主移除相关字典词条。
  - `packages/app/package.json` — 补充 `@types/react-dom` 开发依赖。
- 验证：
  - 单元测试：`project-remove.test.ts`、`project-remove-modal.test.tsx`、`project-picker.test.tsx`、`project-selection.test.ts`、`sidebar-workspace-list.test.tsx`、`i18n/resources.test.ts`（共 69 项全部通过）。
  - E2E 测试：`sidebar-project-grouping.spec.ts` 真实双 Host 隔离环境端到端浏览器测试全部绿灯通过（验证多 Host 移除单台设备成功、验证 HostPicker 仅展示该项目所在的机器）。
  - 全量检查：`npm run typecheck`（7 个 workspace 零错误）、`npm run lint`（0 警告 0 错误）、`npm run format:check`。
- 对 `codestable/` 影响：无架构漂移，符合 `spec/projects.md` 与多 Host 聚合规范。
