# Chief 全局悬浮助理 talk

用户看到 Multica 的悬浮按钮 + 浮窗 + 内建 agent（Mika，Chief of Staff），想在 BySpace 做一个：右下角 FAB 弹出浮窗快速对话；默认分配一个指向 `~/.byspace` 的工作区，用户不用手动添加项目；再进一步注入角色提示词，让它成为 BySpace 的管家；终态是用户只跟它对接各项目的工作，由它去和各工作区的 agent 打交道。用户明确「逐步演进，不能一口气吃成胖子」。

## 与 026 的关系：同一个终态，换了一条不违宪的路

讨论前检索发现这个终态与 `byissue/issues/026-d-cross-workspace-orchestrator.md`（2026-09-30 放弃）几乎重合。026 的死因：编排要成立，宿主必须持有用户的流程和待办状态，而 BySpace 的立场是工作流活在用户自己的 agent 配置里，daemon 不持有它。

本次方案与 026 的差异：Chief 本身就是一个**普通 agent 会话**，跟进逻辑、记忆、待办活在它自己的会话里，daemon 不新增编排状态。**已确认：这是本方向成立的前提，后续演进不得把编排状态做进 daemon。**

讨论中查到的现状事实：

- `workspace.create` 已支持 `kind: "directory"` 且 `projectId` 可选——指向 `~/.byspace`、不挂 project 的工作区零新模型可建。
- daemon 给 agent 注入的 byspace-tools 已有 list/send/权限等编排原语；CLI 命令面（agent / workspace / project / schedule / heartbeat / permit）够当 Chief 的手。
- 前端有 floating panel 基建（`floating-panel-portal.tsx`、`floating.tsx`），右下角无现成 UI 冲突。

## 第一轮定下的形态

- **会话实体**：浮窗里是一个普通结构化会话，挂在自动创建的 "Home" workspace 上；出现在 workspace 列表、可置顶，不做隐藏（隐藏就要发明特殊工作区概念）。
- **Provider**：跟随用户配置，不固定；消息框直接复用现有会话消息框，用户用时自选 provider。
- **浮窗行为**：全局悬浮层、跨路由保持；最大化 = 跳进该会话的完整页面，可缩回；compact（手机）不做浮窗，FAB 直接跳会话页。
- **Host**：每台 daemon 一个 Chief；浮窗头部提供 host 切换入口，切的是整个 app 的当前 host（浮窗不独立维护第二条连接）。
- **命名**：角色词用 **Chief**，不拟人化起名；进 glossary。
- **FAB**：全局常驻，带 Chief 会话的活动圆点（复用现有圆点语义，无新状态语言）。

## Multica 调查带来的事实（fork 在 /Users/zijie/workspace/forks/multica）

- **许可证是 Multica License**（Apache 2.0 + 附加条款）：禁止用于向第三方提供托管/商业产品，UI 代码连改名单抽出都要求保留品牌。**结论：代码与提示词文本都不能搬，只借结构、架构与模式。**
- Mika 提示词只有 29 行，靠三层组装：静态短提示词（角色 + 工作模型 + 协作边界）内嵌二进制；动态上下文（身份、请求者、工作区）每次任务由 runtime brief 现拼；CLI 知识做成按需加载的 skill 文档。
- 浮窗是**通用 agent 聊天面**，Mika 只是带 `system_key` 的普通 agent 身份——佐证「普通会话 + 特殊角色」。
- Multica 明确写 "Never promise to report back"（agent turn 结束即死）。**我们反着来：有 schedule / heartbeat，Chief 可以承诺跟进并真的醒来**——这是差异化，也是通往终态的桥。
- 建议 chips（每轮后小预算 LLM 生成）：用户明确**不做**。
- 可偷：服务端直接写开场消息（不烧 agent run）、固定 starter cards、会话 mounted-but-hidden 保活、路由抑制与全局快捷键一致性。

## 第二轮定下的范围

- 一个**持续会话**，不做多对话/历史列表（模型支持，以后想要再加）。
- 开场三条建议按钮进第一刀，写死、点击即发送；「自定义开场建议」配置不进。
- Home workspace 不加写保护，提示词声明「`~/.byspace` 只读为主，改动前先问」。

## 关键纠正：提示词不走 AGENTS.md，走角色数据结构

我曾推荐把提示词放进 `~/.byspace/AGENTS.md`（cwd 零新机制）。用户否了：**文档承载角色提示词不合理，要引入角色的数据结构设计**，并指出可复用设置里「System prompt」的注入能力。

查证的管道：host 设置 `appendSystemPrompt` → daemon config → 注入该 daemon 所有 agent。复用它的差异只有一个词：作用域——从「所有 agent」收窄到「Chief 会话」。**已确认：**

- 引入 `AgentRole` 实体（name、description、systemPrompt），协议层让 agent 创建时可携带角色，daemon 按会话拼接角色提示词进现有注入管道；Chief 是第一个内建角色。
- Chief 提示词内嵌在 daemon（改文件发版即全体生效），**不做自定义角色的设置 UI**；结构按可扩展设计，UI 等需求被验证。
- 这打破了 `appendSystemPrompt` 所在 orchestration 设置组「all agents」的假设，是实现细节，设计时处理。

提示词初版草案已在讨论中过目（角色行 + Working model + Collaboration 三段，含「可以承诺跟进」反转条款），实现时以此为准继续磨。

## 出口

已确认建 **Epic `byissue/epics/005-o-chief-floating-assistant/`**，三个切片：

1. Home workspace + 角色数据结构 + Chief 身份与提示词注入（issue 001）
2. FAB + 浮窗 UI（含最大化跳页、host 切换、手机跳页、活动圆点）（issue 002）
3. 开场三条建议 + 空状态（issue 003）

**暂不纳入**：建议 chips（用户明确不做）、多对话/历史列表、自定义角色 UI、heartbeat 主动巡视、跨 daemon 编排。演进方向（刀 2 主动性、刀 3 对接深化）留在 Epic spec 的边界内，daemon 永不持有编排状态。
