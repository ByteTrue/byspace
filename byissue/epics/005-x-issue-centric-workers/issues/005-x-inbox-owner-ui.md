---
kind: issue
title: inbox UI：老板的审批队列面
type: feature
status: closed
created: 2026-09-28
---

# inbox UI：老板的审批队列面

> **读者：** 接手的人——inbox 后端已就位（issue 004），这份是把"需要你决策的清单"变成你眼睛能看到、手能整理的面。

## 目标形态（对照源 `packages/views/inbox/components/inbox-page.tsx`）

源是左右分栏：左=列表（inbox / archived 双视图、severity 过滤、行=状态点+标题+相对时间+issue 链接），右=详情（正文+actor+时间+动作）。我们翻译为我们的 compact 约定：

- 宽屏双栏（列表 ~360 + 详情），窄屏堆叠；
- 顶部：`Inbox` 标题 + 未读计数徽章 + Live/Archived 切换 + severity 过滤 chips（action_required / attention / info）；
- 行：severity 色点 + 标题 + actor 名 + 相对时间；未读加重点；
- 详情：标题、正文（Markdown）、actor 头像名、时间、**打开 issue** 按钮（跳 `/multica/issue`）、标记已读/未读、归档/取消归档；
- 空态分两种措辞：inbox 空（"没有需要你处理的"）vs 过滤空（"没有匹配的，撤销过滤"）—— 沿用看板的既有判断。

## 数据面

`multica.inbox.list` 已返回 items+unread；动作走 mark/archive。轮询间隔 5s（队列是活的：run 随时可能上桌）。

## 影响面

- 必须改：app 新增 `multica-inbox.tsx` + 入口（看板 header 的铃铛/计数，源的入口在顶栏）。
- 需要验：宽/窄两形态；真机点读/归档；run 失败条目在 UI 出现并可处理。
- 仍未知：无。

## 验证

- 真机：触发一次失败 run（或秘书 escalation）→ UI 见 action_required 未读 → 点开 → 标读 → 计数归零 → 归档 → Archived 视图见它。
- 390px 不塌。

## 执行记录

- 新面：`multica-inbox.tsx`（列表+详情双栏、窄屏堆叠带返回行）+ 路由 `app/multica-inbox.tsx`；看板 header 铃铛入口带未读计数徽章（`useMulticaLiveState` 增 inboxUnread）。
- 列表：Live/Archived 切换、severity 过滤 chips、行=severity 色点+标题（未读加粗+蓝点）+actor 名+相对时间；空态三措辞（过滤空/归档空/队列空）沿用看板判断。
- 详情：severity 标签+相对时间、标题、actor 头像名、正文 Markdown、动作=Open issue（跳详情）/Mark read·unread/Archive·Unarchive。
- 轮询 5s（队列是活的）。
- lint 纪律：per-row 回调与 chip 回调都下沉到子组件内的 useCallback；图标以 kind 传入而非 JSX-as-prop；空态措辞走 helper 消嵌套三元。
- 真机（2026-09-28，浅色 1080p）：探针条目（issue 004 的 run escalation）在 UI 出现为未读 action_required → 点开见详情与三动作 → Mark read 后徽章消失（DB read=1）→ Archive 后 Live 空、Archived 见它（DB archived=1）；重载后两视图与 DB 一致。截图 /tmp/ours-inbox\*.png。
- 过程抓到一个检查自身的坑：我用正则判"徽章消失"会空真（正则不匹配也可能因排版），改以 DB 读回 + 重载后 DOM 计数双证。

## 关闭回写

- Epic spec 进度；parity-audit 欠账面 inbox UI 行标记完成。
