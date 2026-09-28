---
kind: issue
title: autopilot 面补齐：空态模板卡 + Issue wakeups tab
type: feature
status: closed
created: 2026-09-29
---

# autopilot 面补齐：空态模板卡 + Issue wakeups tab

> **读者：** 接手的人——真服务对照（ref-Autopilot-low.png）下 autopilot 面缺的两块。

## 源形

- 空态=图标圈+标题+描述+**六模板卡**（daily_news/pr_review/bug_triage/weekly_progress/dependency_audit/documentation_check，各带 prompt 全文+schedule 预设）+Start from scratch；点模板=创建表单预填。
- 页内两 tab：Autopilot / **Issue wakeups**（workspace-wakeups.tsx：全 workspace 的 issue wakeup 登记表，行=issue+enabled，行内 enable/disable）。

## 我们现状

- 空态只有句+New autopilot 按钮（029 已换整形但无模板）。
- 无 wakeups tab（wakeup 只有 CLI 与秘书自登记，无管理面）。

## 收法

- 六模板进创建表单预填（prompt+schedule 文案照抄源 TEMPLATES）；空态渲染模板卡网格，点击=开表单带预填；Start from scratch=空表单。
- RPC `multica.wakeup.workspace_list`（issue 行+enabled）+ 行内 enable/disable（disable 已有；enable 需 create 的复活语义——查 store 是否幂等）；UI tab。

## 验证

- 单测：workspace wakeup 列表含 enabled/disabled 行、enable 复活不重复行；
- 真机：模板卡点开表单见预填 prompt；wakeups tab 见登记表且 disable/enable 落库。

## 执行记录

- 六模板（id/标题/摘要/prompt/cron 预设）照抄源 TEMPLATES 与 locales；prompt 落 description 字段（源同：注入 run 的正文）、cron 预设落 cron 输入；空态=整形+模板卡网格+Start from scratch；点卡=表单带预填（form 以 template.id 为 key 重挂载——uncontrolled 输入的 initialValue 只在挂载时读，同 notes 家族）。
- wakeups tab：RPC `multica.wakeup.workspace_list`（全 workspace 登记+issue 标题）+ `multica.wakeup.enable`（disable 的反向：enabled=1+清 disabled_at，同一行复活不复制——源同 save 路径）；行内 on/off 切换。
- **源纪律补进 disable/enable**：两写都要求人类 originator（member，或 in-flight run 携带的 originator；terminal run 拒——"a finished run cannot control wakeups"）。disable 此前无门，现加 senderSessionId（加性）；CLI 两动词传 BYSPACE_AGENT_ID，console 无会话=owner 面。
- CLI 补 `wakeup enable` 与 `wakeup ls-all`（workspace 登记表）。
- 测试：enable 复活同 id、不复制、workspace 列表见行。
- 真机：空态六卡+scratch+两 tab；模板卡预填（Bug triage / prompt 首行 / cron 0 9 \* \* 1-5）；wakeups tab 五行登记，行内 toggle 在。验证残留 Minute patrol 已归档。
