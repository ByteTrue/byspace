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

## 已解决：对话面不需要新建（实测修正）

**原先我把它记成"需要先决定是否给 worker 加对话回合"的未决项。实测后发现前提是错的。**

上游详情页右侧的表头是 **"New task"** —— 也就是说**对话就是那个任务**。而 BySpace 的任务本来就会起一个 agent session，`byspace agent send <id> <prompt>` 也早就存在。所以对话能力早就有了，**缺的只是任务没有记住自己的 session**（agent id 只躺在一条 history note 里）。

改动因此很小：`worker_tasks.agent_id`（schema v5→v6，真实库上验过）、跑完记下 session、`WorkerTaskSummary` 带上它、组报告里的任务行可点开。

**真机验证：** 点组视图里的任务 → 打开 `…/workspace/…` 的会话，能看到该 worker 的完整往来，并在同一条 session 上继续追问（`agent send` 走的是同一个会话）。**BySpace 已有会话面，这条路径是复用而不是新建。**

顺带看到技能真的生效：worker 面对一个措辞含糊的任务时**没有猜**，而是报了 blocker 并反问三个问题 —— 这正是技能里写的「If you are blocked, say what is blocking you rather than claiming you started」。

## 已完成（本 issue 范围内）

- **worker 详情页**：卡片可点开，含 Back、身份头（头像/名字/角色/简介/状态·主机）、Work Log 四个计数、任务列表。任务行按同一条规则打开所在会话（没跑过的任务不可点）。
  **未抄的部分及理由**：上游那一页还有记忆、自进化技能、插件、连接器、知识库等分区 —— 那些能力本域不存在也不在范围内，不搭空壳。也**没有抄图表**（贡献热力图、任务类型环图）：任务只有几条时它们承载的信息少于四个数字，而一个"四种方式都说 0"的图比数字更差。
- **建组模态**：标题 + 分组标题 + 主从式成员选择（左列表、右配置），**Leader 是选中成员身上的开关**而不是独立控件 —— 独立控件能让你在不看见人的情况下指定谁带队。窄屏下主从改为纵向堆叠。

**有意保留的差异：** 顶部保留了项目选择器（上游没有）—— 这是**模型差异而非遗漏**：本域把组绑到 project id 以便 checkout 移动后仍指向同一项目，上游绑 workspace。上游右侧的"响应模型"与"每成员工作区"没有抄：本域只跑一个 provider，工作区属于组，抄过来背后没有东西。

**明确不抄：** `@Waker` 与 `Autonomous Work` 两个入口 —— 对应本 Epic 明确不做的自动化面。
