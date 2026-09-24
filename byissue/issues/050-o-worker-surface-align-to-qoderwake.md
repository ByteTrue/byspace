---
kind: issue
title: "worker 面照搬 QoderWake 的上线形态：信息架构、卡片名册、waker 详情页与建组模态"
type: feature
status: open
created: 2026-09-24
related_issue: byissue/epics/004-x-worker-domain/spec.md
---

# worker 面照搬 QoderWake 的上线形态

> **读者：** 要把 worker 页从"我自己设计的控制台"改成"QoderWake 实际长的那样"的人。先看要抄成什么样，再看差在哪、为什么。

## 结论先行

Epic 004 照搬的是 QoderWake 的**数据模型、命令面与协作机制**；**UI 与交互是我自己设计的**，因此主路径与上游不同。Owner 明确要求：**做 UI/交互/逻辑前先看 127.0.0.1:19820，能抄就抄，视觉与交互也直接抄。**

实测证据见 `byissue/talks/003-worker-domain-qoderwake-reference.md` 第 6 节（含截图与逐项对照）。

## 差在哪（按优先级）

**1. 主路径不同（最重要，其余都是它的后果）。**

- 上游：**点进一个 waker → 跟它说话 → 它的活以任务形式出现在旁边**。waker 详情页是独立路由 `/conversations/entry/latest?waker=<id>`，三栏：应用导航 ｜ 该 waker 的 `Tasks ｜ Automations` + `+ New` ｜ 任务/对话面（空态为头像 + 招呼语 + **从角色能力生成的起始提示** + 输入框）。
- 我做的：名册 + 任务表，读而不做。**没有 waker 详情页这一层。**

**2. Group 不是顶层导航项。** 上游把 `Waker (11) ｜ Group (0)` 做成 **Waker Management 页内的分段控件**；我做成侧栏的独立分区。

**3. 名册是卡片网格，不是行。** 上游四列卡片，第一格是虚线边框的「+ New Waker」卡；卡片含圆形角色插画、`● Online` + `▣ Local` 徽标、名字、角色徽标、三行描述、页脚 `Tasks 0 ｜ Last Run Never`。工具条有 搜索 / Runtime status / Role / Environment / Sort，右显总数。

**4. 建组是模态，且成员选择是两栏主从。** 左栏搜索 + 复选框列表，右栏是选中者的配置面（响应模型与工作区）；页脚左侧计数、右侧 Cancel/Create。提示文案「choose one Leader」——**Leader 从成员里选一个**，与我们 coordinator 同义。

**5. 空态范式**：居中 + 虚线圆角方框内图标 + 标题 + 一句说明 + 主按钮。

**6. 侧栏底部身份区**（头像 + 名字 + 套餐 + 帮助/设置图标），名册区带 `Waker (n) ｜ Group (n)` 标签页。

## 范围

**做：** 上述六项的形态对齐。信息架构按上游重排（一区一路由）；补 waker 详情页；名册改卡片网格；建组改模态；Groups 降为 Waker Management 内的标签页。

**不做：** 不改 worker 域的数据模型、RPC 与权限（那些已按上游落地并有验证）；不引入上游的云端依赖（IM、Knowledge Base、Autonomous Work 的触发器）——它们在本仓库仍是明确不做的范围。

**保留差异（有意）：** 术语用 `worker` 而非 `waker`；样式用 BySpace token 与设计系统重做，不照抄视觉细节（`docs/design.md`）；运行时不接多 provider。

## 判据

- 从 Dashboard 出发，能在**两次点击内**到达「跟某个 worker 说话」并发出第一条消息。
- 名册在 1440px 宽下呈多列卡片网格；在 390px 下不塌陷（当前窄屏修复只覆盖了四分区版本）。
- Group 不再出现在顶层导航；在 Waker Management 内可切换。
- 建组模态的成员选择与 Leader 指定可在窄屏完成。
- 起始提示来自角色模板能力，不是硬编码文案。

## 已知风险

- 上游的 waker 详情页承载"对话 + 任务 + 自动化"三者，而 BySpace 的 worker 任务当前是**异步运行、无对话面**的（`worker.task.run` 是阻塞式，没有交互回路）。照抄详情页需要先决定：**是否给 worker 加对话回合**。这是设计决定，不是排版决定，应先在 Design 里定下再动 UI。
