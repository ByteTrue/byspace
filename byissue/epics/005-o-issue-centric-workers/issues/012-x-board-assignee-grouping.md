---
kind: issue
title: 看板第二轴：assignee 分组（列切换 + 拖拽跨轴语义）
type: feature
status: closed
created: 2026-09-29
---

# 看板第二轴：assignee 分组（列切换 + 拖拽跨轴语义）

> **读者：** 接手的人——分组切列时拖拽写什么、position 在两个轴下的语义、swimlane 为何不做。

## 源语义（board-view buildColumns + drag-utils + handler/issue_move.go）

- 列轴 GROUPING：status / assignee / project（我们无 project 域，取前两轴）；assignee 轴含 `assignee:unassigned` 列。
- 拖拽写 = 目标列的维度字段 + position；position 由**邻接锚的中点**定（before/after 两锚取中点、只有一锚时 ±1、无锚=保持）；服务端校验锚序（stale/too close 报错）。我们客户端在 drop 时从刚读的列表算中点，revision 守卫兜并发，语义等价；差异=无锚序报错（记此）。
- position 的作用域是 (workspace, status)：assignee 轴下拖拽不改 status，position 仍在其 status 列内排——即"换人"与"换列内顺序"一次写。
- swimlane（行轴：parent/project/assignee）不在本批：它是第三个渲染轴，信息面与列轴重复度高，记欠账。

## 翻译

- board 的 Grouping 两态切换（Status / Assignee），列集合派生：status 目录 或 agent 名单+Unassigned。
- drop 面 id 编码轴：`status:<key>` / `assignee:<id|unassigned>`；readDropTarget 返回 {status?, assignee?, position}，position 用现有 slotPosition（中点/端点规则，与源 issueMovePosition 数值规则同）。
- 写：multicaIssueUpdate 一次带 position + 轴字段（status 轴带 status；assignee 轴带 assigneeType/assigneeId，unassigned=两者 null）。
- 纯逻辑（列派生 + drop 目标解析）抽 multica-board-grouping.ts 单测。

## 范围

- 包含：Grouping 切换、assignee 列（含 unassigned）、跨列拖拽两轴语义、单测。
- 不包含：project 轴、swimlane 行轴、列过滤（chips 已有）。

## 验证

- 单测：两轴列派生（含 unassigned 收纳）、drop 中点/端点/空列三例、assignee 轴 drop 产出的写载荷带 assignee 不带 status。
- 真机：切 Assignee 轴看到按人分列+Unassigned；把卡从 Writer 列拖到 Unassigned → DB assignee 清空且 position 落槽；切回 Status 轴原列序不乱。

## 执行记录

- 纯逻辑落 multica-board-grouping.ts：buildColumns（status 目录 / 名册+Unassigned）、issuesForColumn、resolveDrop（卡与列体都是 drop 面；slot 中点/端点/空列顶，与源 issueMovePosition 数值规则同）、slotPosition/slotAtCard。11 单测锁两轴派生、unassigned 收纳、assignee 轴 drop 不带 status、Unassigned 清 assignee、中点与夺槽两例。
- board：Grouping 两态切换（By status / By assignee）在 Display 切换旁；drop 面 id 编码轴（status:<key> / assignee:<id|unassigned>）；一次写 = 轴字段 + position。
- **抓到的两个真缺陷（都靠真机+DB 读回暴露）**：
  1. store updateIssue 的 position 只在 status 变更分支里写 —— assignee 轴拖（无 status）丢 position。改为 position 独立维度（源 UpdateIssue 本就独立）；补两测试（同状态拖重排、只改 assignee 的拖重排）。
  2. client multicaIssueUpdate 的 `assigneeType ?? undefined` 把**显式 null 吞掉**（null 是 nullish）—— 清 assignee 的写永远到不了服务端。显式 null 是真写，改直通；探针验清/设双向。
- 浏览器教训复记：agent-browser 的 drag 对 status 轴可用（列体 droppable），但首轮 assignee 轴"拖了没写"的真因是上面两个缺陷，不是拖拽机制 —— 先对照实验（status 轴同姿势能写）再怀疑机制，省了一轮对 dnd 的冤枉排查。
- 真机：切 assignee 轴三列（Chief of Staff/Writer/Unassigned）；#3 从 Writer 拖到 Unassigned → DB assignee 空、status 不动、position 落槽；切回 status 轴列序与 DB 一致。截图 /tmp/ours-grouping.png。
- 欠账：project 轴（无域）、swimlane 行轴、拖拽的锚序校验（源 issueMovePosition 的 stale/too-close 报错；我们以 revision 守卫兜并发，无锚序报错，记差异）。

## 关闭回写

- Epic spec 进度；parity-audit 泳道/分组行更新（列分组完成、swimlane 仍欠）。
