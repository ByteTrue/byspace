---
kind: issue
title: 面对齐：产品左导航 rail + 每列"+"建 issue（源 IA）
type: feature
status: closed
created: 2026-09-29
---

# 面对齐：产品左导航 rail + 每列"+"建 issue（源 IA）

> **读者：** 接手的人——真服务对照（selfhost-build 起 04cdd48 源码栈）暴露的两处 IA/交互差距。

## 对照方法（本轮新增能力）

Docker Desktop 起来后 `make selfhost-build` 从归档源码构 backend/web 两镜像（非官方 release 镜像），栈=PG+backend(8080)+frontend(3000)。登录=magic code：无邮件后端时验证码打印在 backend 日志（`[DEV] Verification code for …`），verify 后拿 token 注入 web 的 `localStorage.multica_token`。onboarding 三步（about-you→workspace→mika）可 Skip。截图组在 /tmp/ref-\*.png。

## 差距

1. **左导航 rail**：源面有自己的产品 nav（Search/New Issue/Inbox/My Issues/Chat；Work: Issues/Projects/Autopilot；AI Team: Agents/Squads/Skills/Runtimes；底: Analytics/Settings），inbox 未读数在 nav 行上；我们的入口散在 board/rosters 头的 pills 与顶栏铃铛——功能齐但 IA 不是源形，跨面跳转要回 board。
2. **每列"+"**：源列头 `…`+`+`，`+` 以该列 status 为默认建 issue；我们只有全局 New issue（默认 backlog）。
3. 顶栏右三件（All/Members/Agents 分段 + Filter/Display 按钮组）：我们 chips 平铺 + view toggle，功能等价、形态偏离——记偏离不改（chips 平铺在窄屏更省一步，Filter 弹层是纯形态）。

## 收法

- 新 multica-nav.tsx：MulticaNavRail（Work: Board/My Issues/Inbox(未读徽标)；AI Team: Agents/Squads(rosters 内)/Autopilots；底: Chief of Staff workspace 入口）；各面页包 shell（rail+main）；pills 退役（Mine/Rosters/Autopilots/铃铛），Secretary 入口进 rail。
- 窄屏：rail 收成横向滚动条（顶部），不遮挡内容。
- 列头加 `+`：开 New issue 表单且 status 默认=该列（表单增默认 status 入参；创建后该列见新卡）。

## 验证

- 真机：rail 六入口逐一点通（含未读徽标数与 inbox 一致）；列+建 issue 落在该列；窄屏 rail 横条不溢出；
- 截图对照 /tmp/ref-board.png 与我们的 board。

## 执行记录

- 对照栈起法记入本 issue（可复现）：Docker Desktop → `make selfhost-build`（从归档源码构两镜像，非官方 release）→ PG+backend(8080)+frontend(3000)；登录=magic code 打 backend 日志（无邮件后端时），verify 后 token 注入 web 的 `localStorage.multica_token`；onboarding 三步可 Skip。截图组 /tmp/ref-\*.png（board/issue-detail/inbox/my-issues/autopilot/agents/squads/settings-labels）。
- **nav rail**：multica-nav.tsx 的 MulticaShell/MulticaNavRail（Work: Board/My issues/Inbox 徽标；AI team: Agents & squads/Autopilots；Chief of Staff workspace 门）；五面包 shell（board/mine/inbox/rosters/autopilots），pills（Mine/Rosters/Autopilots/铃铛/Secretary）退役删除；窄屏 rail 收成顶部横条（390px 无溢出）。
- **列"+"**：status 轴每列头加 `+`（列默认 status 开表单），assignee 轴不加（源同：列头 `+` 只对 status 语义）；全局 New issue 按钮改为只在表单关闭时显示（表单开时收进表单自己的 Cancel/Create）。
- 顶栏三件（All/Members/Agents + Filter/Display 按钮组）记为**有意偏离不改**：chips 平铺在窄屏省一层弹层，Display/Board toggle 已有；功能面等价。
- 真机：rail 五入口逐一点通（board/mine/inbox/rosters/autopilots 往返）、inbox 徽标 1 与未读数一致、列+建 issue 落 in_review、Chief of Staff 门在有秘书 workspace 时出现。
- **验证法缺陷（记入 notes 家族候选）**：expo-router 的栈保留底层页挂载，其 rail 实例塌成 0×0；选择器首个匹配是那个折叠鬼影，click 被"covered"拒——人眼永远只见顶层的可见实例（elementFromPoint 命中的是行内 Text 子元素，截图亦干净）。修法：点击目标必须过滤 `getBoundingClientRect().width>0` 的可见实例。产品无缺陷；是我的点击探针选错了对象。

## 关闭回写

- parity-audit F 行 nav/列+ 收口；毕业 spec 的"故意没有"不动（Projects/Skills/Runtimes/Analytics/Settings 圈仍欠，理由同前）。
