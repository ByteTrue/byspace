---
kind: issue
title: autopilot 管理 UI：列表、详情（runs）、创建表单
type: feature
status: closed
created: 2026-09-29
---

# autopilot 管理 UI：列表、详情（runs）、创建表单

> **读者：** 接手的人——源的 autopilot 页是表格+过滤+webhook 面板；我们抄哪几块、为什么。

## 源形态与取舍

源 `/autopilots` 是宽表格（assignee/trigger/last run/next run/mode/creator/created + 多维过滤 + webhook deliveries 面板 + 编辑触发器对话框）。我们抄**信息面**不抄表格形态（我们的 console 是卡片语汇）：

- **列表**：卡网格 = 标题 + 状态点 + mode 标 + assignee 名 + schedule（cron 或 manual）+ last run 相对时间；卡开详情；
- **详情**：头部（标题/状态/mode/assignee）+ 动作行（Trigger now / Pause / Enable）+ triggers 列表（kind+cron+next run）+ runs 流（source/status/时间/失败原因/issue 链接）；
- **创建表单**：标题、描述、assignee（agent 名单）、mode 两态、可选 cron+timezone —— 源的创建对话框的子集（webhook/api 触发器不在面内，行为本就 defer）。

不抄：webhook deliveries 面板、订阅者多选、quota 通知、列过滤（量小无意义）、表格形态。

## 影响面

- 只加 UI：新路由 /multica/autopilots 与 /multica/autopilot（详情），rosters 页 header 加入口药丸；RPC 全在（006/后续 status 面已建）。
- 需要验：列表显示真 autopilot（含 schedule 与 last run）；详情 Trigger now 真触发（run 行出现）；Pause 后状态点变灰且 tick 不再 fire；创建表单落地一条带 cron 触发的 autopilot 且 next_run_at 有值。

## 执行记录

- 两路由：/multica/autopilots（卡网格+创建表单）、/multica/autopilot（头部三动作+triggers+runs 流）；rosters 页 header 加 Autopilots 药丸为入口。
- 信息面对照源表格页：mode 标、状态点（active 绿）、assignee 名、schedule（cron 或 manual）、last run 相对时间；详情 runs 行带失败原因与 issue 链接（有则按）。
- 创建表单 = 标题/描述/assignee 名册 chips/mode 两态/可选 cron；提交走 multicaAutopilotCreate，成功即回列表并刷新。
- 真机（8083）：建 "Nightly digest"（cron 0 21 \* \* \*）→ DB 有 trigger 且 next_run_at=当日 21:00Z；详情 Trigger now → runs 1、DB run source=manual status 行进；Pause → DB status=paused 且按钮翻 Enable。验证后该 autopilot 经 CLI archive 归档（不留会真到点烧 token 的活体）。
- 浏览器教训复记：RN-web 的 uncontrolled 输入（initialValue）不吃合成事件，必须 agent-browser fill 真键入；Pressable 不吃合成 click，必须 testID + 真点击。首轮"提交了但没建上"即由此。
- 质量：typecheck 0 / lint 0；域测不变（纯 UI 批）。

## 关闭回写

- Epic spec 进度；parity-audit 的 autopilot UI 欠账行关闭（webhook 面板仍欠）。
