# Issue-centric workers（multica 复刻面）

> **读者：** 想知道「把需求交给秘书、它自己组团队干活并向我汇报」这套面当前是什么、哪些边界是长期的、哪些面故意没有。实现过程与验证证据在已关闭的 Epic 005 issues 与 [对照审计](../epics/005-x-issue-centric-workers/parity-audit.md)。

这一面是 multica（multica-ai/multica，Apache-2.0）的 1:1 Node 复刻，只砍多租户。它的产品形状一句话：**老板带目标来，不带路由决定来**——秘书（内置 Chief of Staff）自己决定拆派，工作记录在 issue 上，需要老板拍板的事上收件箱，其余它自己跟进。

## 谁对谁说话

| 角色/对象           | 是什么                                                       | 面在哪                                         |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| owner（老板）       | 单用户形态里唯一的"我"                                       | console 各面 + inbox 的读者与归档者            |
| 秘书 Chief of Staff | 内置 system agent + 预设指示；对话=常驻 workspace 的普通会话 | 看板药丸进 workspace                           |
| worker              | 用户建的 agent；一次 run 一个会话                            | rosters 页 / 详情                              |
| squad               | 纯名单（leader + members），不是群聊空间                     | rosters / 详情加移成员                         |
| issue               | 工作单元与记录本体：评论=对话+工作记录合一条流               | 看板（status/assignee 两轴）/ 详情 / my-issues |
| run                 | 队列里的一行执行（attempt 谱系、session 反解身份）           | Execution log / agent 详情的 run feed          |
| inbox               | 老板的待办箱；severity 三档；agent 只能写、不能读管          | console inbox 面                               |
| autopilot           | 站着不动的声明：schedule/api 触发、两模式                    | 列表/详情/创建表单                             |
| wakeup              | agent 自登记的事件唤醒（issue 状态变化叫醒它自己）           | CLI + 秘书指示语义                             |

## 记录即 issue

issue 的流不是"评论列表"，是 **activity 与 comment 按时间合排的 timeline**：谁建了它、哪个字段从什么改到什么、哪次 run 成或败、谁说了什么，一条流读完。审计行在写事务内落（源是事后监听；同事务是翻译且更强），未变化的字段不写——时间线不叙述没发生的写。run 的话归 run 自己（session 反解身份），owner 的话归 owner；这个归属是触发路由、审批归并、自触发守卫三者的前提。

## 长期边界（改之前先读）

- **1:1 复刻纪律**：源有的设计直接用，不预改。两处已批准的偏离：砍多租户；Go 后端用 Node 复刻。执行留在 daemon 内进程会话（不走源的本地 CLI 子进程）也是已批准偏离——代价是没有多机 claim，收益是不依赖外部进程形态。
- **单 daemon 前提**：in-process 领取集等价于源的 SKIP LOCKED 只在此前提下成立。第二个 daemon 加入时，领取必须换成数据库级原子领取，不是再加一个进程内集合。
- **inbox 是 owner 的面**：agent 只有一个动词（create）。读/标/归档对 run 会话机械拒绝——老板的桌面不能被代理人清空，哪怕代理人是秘书。
- **mention 是 markup**：`[@名](mention://agent/<id>)`，裸 @ 单词名只是兼容别名。多词名靠 markup 携带 id，不靠解析名字。
- **position 的作用域是 (workspace, status)**：assignee 轴拖拽只换人不换状态，position 仍在其状态列内排；显式 position 是拖拽落点，赢过状态变更的重排列顶规则。
- **子 issue 不级联**：父状态变化不动子；子树只是展示分组。子树退订（源的 ancestor opt-out）未做。
- **退订是软的**：unsubscribe 盖戳不删行；再次隐式触发（如再评论）复活。同人多次触发只留一行最新 reason。
- **archived 是终态面**：agent 与 autopilot 的 archived 行退出默认列表、详情不给控制；写路径与源同无迁移门，门在面上。
- **重试只认启动期失败**：环境没起来才重试（子 task、attempt+1、到顶即终话）；权限等待、取消、中途错误不重试——中途失败无结构化理由码时重试是拿昂贵循环赌运气。

## 故意没有的面（欠账，带理由）

- **task_supplement**（给在飞 run 插话）：执行形态一次 run 一 turn，无插话面；排队等结束再发的假 supplement 会骗人。
- **附件**：attachment 行的 url 需要文件存储+静态服务基础设施（源是对象存储圈）；硬挂列即空壳。
- **autopilot 的 webhook 触发与 replace 语义**：webhook 是公网面（端点+鉴权），与 IM 场景同源，均 defer。
- **Token 面板**：无计量面；Execution log 读队列行已够"这 issue 跑过什么"。
- **泳道行轴 / project 轴 / agents 配置 tabs / skills 与 runtimes 页**：表在、行为或域不在；建壳即装饰。label 管理面已建（025）。
- **composer 的光标中间触发与键盘导航**：text-input 的 handle 只有写面（replaceText/reset），无光标读面；尾触发 v1 已闭环语法。

## 不承诺

- 多租户、团队席位、计费——砍掉的圈，不因任何需求复活。
- chat 页（源的 Daily Tasks 助手）：Owner 裁决不做；对话留在 workspace 会话与 issue 流两处。
- 与 multica 上游的协议兼容：这是硬分叉，不复刻它的 REST/WS 线格式。
