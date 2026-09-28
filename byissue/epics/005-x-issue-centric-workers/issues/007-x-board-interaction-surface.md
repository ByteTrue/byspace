---
kind: issue
title: 看板交互面：position 语义修复 + 拖拽 + 列表视图 + 过滤
type: feature
status: closed
created: 2026-09-29
---

# 看板交互面：position 语义修复 + 拖拽 + 列表视图 + 过滤

> **读者：** 接手的人——列内排序为什么必须由 position 说了算、拖拽写什么、列表视图与过滤照源的哪一面。

## 先修 position 语义（拖拽的前提，源 issue.sql UpdateIssue 的 CASE 三分）

现状漂移：`createIssue` 从不写 position（DDL 默认 0），列内顺序全靠 created_at 兜底；一旦有卡片被拖出显式 position，与 0 混排即乱。源语义三条：

1. **新建 = 列顶**：`NextTopPosition` = 同状态 MIN(position, 0) - 1；
2. **状态变更（无显式 position）= 重排到目标列顶**：同 1 的公式（CASE 第二支，注释明说"position 只在同列内有意义，换列即失效"）；
3. **显式 position 赢**（拖拽落点）：CASE 第一支，status 与 position 同写。

修法：store 的 createIssue / updateIssueStatus / updateIssue(status 变更) 套 1 与 2；`multica.issue.update` 协议增可选 `position`（增量字段）套 3。ORDER BY 已是 `position ASC, created_at DESC, number DESC`（源同款唯一终键），不动。

## 交互面（照源 board-view / list-view / filter-chips-bar / issues-header）

- **Display 切换**：Board ↔ List 两个视图面（源的顶栏 Display 菜单在我们的形态收成两态切换）；
- **Board 拖拽**：列内排序 + 跨列（status+position 同写，源 drag-utils 的 DragMoveUpdates 语义）；app 已有 @dnd-kit 依赖（web 构建）；拖拽中本地列镜像、settle 回调后回读（源 useDragSettle 的锁语义：drag/settle 期间冻结本地列，避免中途 refetch 抖卡）；
- **List 视图**：源的 list-row 形态（状态点+标题+#编号+priority+assignee+相对时间 的密行），分页/加载更多不在本批（数据量小，一次取全）；
- **过滤 chips**：status / priority / assignee 三类（源 filter-chips-bar 的子集；label/project 过滤我们无 label 域，project 过滤留后续）；过滤纯客户端（列表已全量在手），chips 行置于看板与列表共用。

## 范围

- 包含：position 三语义 + 协议 position 字段 + 拖拽 + list 视图 + 三类过滤 chips + Display 切换。
- 不包含：分组（grouping by assignee/project 的泳道）、泳道拖拽、label/project 过滤、分页加载更多、swimlane。

## 影响面

- 必须改：store（createIssue/status 变更写 position）、protocol（update 增 position）、app board（dnd + list + chips + display）。
- 需要验：拖拽跨列后 DB 的 status+position 与落点一致；同列拖拽只改 position；状态经属性面板改后该卡到目标列顶；新建到列顶；list 与 board 数据同源同序。
- 仍未知：无。

## 验证

- store 单测：三语义各一例 + 并发同状态变更不产生不稳定序（唯一终键断言）。
- 真机浏览器：拖一张卡跨列、列内换位、切 list、加过滤 chip，各截一图。

## 执行记录

- position 三语义落进 store：createIssue 写 NextTopPosition（MIN-1）；updateIssueStatus 与 updateIssue(status) 无显式 position 时重排到目标列顶、有则赢（源 UpdateIssue 的 CASE 三分）；协议 multica.issue.update 增可选 position（增量字段）与 summary 的 position。四个 store 测试各锁一语义。
- 看板重写：顺序即 store 序（position ASC 唯一终键），删掉了先前按 number 倒排的自创排序；DndContext + useDraggable/useDroppable（列体与卡都是 drop 面），落点 position 取插入槽（空列 -1 / 列顶 MIN-1 / 列尾 MAX+1 / 中间取中点），status+position 一次写（源 DragMoveUpdates 语义）；DragOverlay 提卡。
- List 视图：源 list-row 的密行形态（状态点+标题+#号+priority+assignee），与 board 同一数据同一过滤；Display 两态切换在 header。
- 过滤 chips：status（目录驱动）/ priority（五档）/ assignee（名册驱动，系统 agent 除外），纯客户端（列表全量在手），Clear 出现在有过滤时；空过滤与空结果两措辞。
- catalog 增 agents 名单（assignee chips 的源）；列体与卡补 testID 供拖拽验证定位。
- 真机（8083，浅色）：跨列拖 #4 → in_progress 且 position=-1（空列列顶）；再拖 #3 → -2 压在 #4 上（重排到列顶），UI 序与 DB 序一致；Todo chip 使 3→2 且 Clear 出现；List 三行；切回 Board 无残留。截图 /tmp/ours-board-v2.png、/tmp/ours-list-view.png、/tmp/ours-board-final.png。
- 环境坑记一笔：8081 被**另一 checkout 的 expo** 占着（绝不能杀），本 worktree 的 UI 验证走 8083（EXPO_PORT=8083 ./scripts/dev-app.sh，其注入 EXPO_PUBLIC_LOCAL_DAEMON）；直启裸 expo 会缺该 env。
- 偏差：过滤 chip 行的分段排布比源的 filter 菜单朴素（源是下拉多选+搜索，我们是横排 chips）—— 功能面齐、形态从简，记此不改。
- 欠账仍存：泳道分组、label/project 过滤、分页加载更多、swimlane 拖拽（issue 范围已记）。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面"拖拽/列表视图/筛选"行标记完成。
