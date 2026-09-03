---
kind: issue
title: "将 Agent stream 控件移到 Composer 操作行"
type: feature
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# 将 Agent stream 控件移到 Composer 操作行

## 做成以后是什么样

Active Agent 的“收起所有工具”和“滚动到底部”显示在消息框上方的现有 Composer track 行右侧，不再占用 Pane Header。Desktop、split pane 和 compact 布局保持同一位置。

**范围：** 只移动 active-composer 控件；不改变 Collapse All、detached-tail、scroll visibility 或 archived/read-only stream 的 floating button 行为。

## 为什么现在做 / 当前坏在哪

ITEM-21 将两个控件接入 Pane Header。当前产品希望它们与 Composer 的 task、subagent、plugin 和 diff 状态操作共用同一行，以减少顶部 chrome，并让动作更靠近消息输入区。

## 方案与实现安排

- 复用 `ComposerTrackBar`，不增加第二条工具栏。
- `ChatAgentReadyContent` 继续拥有 stream ref、collapse 与 scroll callback；只把已 memoized 的 controls 作为 `AgentTracks` 右侧 actions。
- controls 使用固定宽度、`marginLeft: auto` 和 `flexShrink: 0`，左侧 pills 保持现有滚动/收缩行为。
- 删除已无消费者的 Pane Header portal host 和 64px desktop 预留空间。

## 验证与执行记录

- Browser E2E 通过：目标用例 1/1；相关 `chat-outline.spec.ts` 13/13。
- E2E 覆盖 collapse、后续 reasoning 展开、scroll-to-bottom、compact 和 split pane，并明确断言控件位于 Composer 上方、Pane Header host 已移除。
- Compact 和 split screenshots 已生成于该测试的 Playwright output 目录。
- Targeted lint、root typecheck、Impeccable layout detector：通过，detector 0 findings。
- 独立只读 review 的 P1 陈旧 chat-outline 定位器和 P2 header 预留空间均已修复并复验。

## 关闭结论

- 判断：active Agent 控件已移动到 Composer 上方唯一操作行，旧 Pane Header host 和预留空间已删除，可以关闭。
- 验证：Browser E2E、截图 review、root static gates 与独立 review 全部通过。
- 毕业：当前布局、状态和响应式关系已写入 `../spec/agent-conversation.md`。
- 遗留：无。
