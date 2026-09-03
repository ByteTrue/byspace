---
kind: issue
title: "修复 Terminal 中文快照回放间距"
type: bug
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# 修复 Terminal 中文快照回放间距

## 做成以后是什么样

Terminal 的中文和其他双宽字符在 snapshot、scrollback 和 replay 后保持连续，不再在字符后插入额外空格；用户无需重新加载恢复排版。

**范围：** 只修复 daemon snapshot/replay 序列化；不修改字体、主题、字号或 native renderer。

## 为什么现在做 / 当前坏在哪

旧归档需求已定位同一问题：xterm 使用一个 `width=0` cell 作为双宽字符的后半格，序列化器把该占位格的空 `chars` 转成普通空格，导致每次 replay 都把后续内容右移。当前 `main` 的 `terminal.ts` 和 `terminal-snapshot.ts` 都回归到了该行为。

历史最终实现来自归档 commit `b0752f54b23ee5e0be7d01869eb95d16f20334a5`。当前 native renderer 已保留另一个 exact-cell glyph 修复 `dc6f13e31edbaa5c8986063707e83b8d9e242138`，本事项不重复修改。

## 方案与实现安排

- `packages/server/src/terminal/terminal.ts`：snapshot 和 scrollback 统一读取同一 active buffer，并跳过 `width=0` cell。
- `packages/protocol/src/terminal-snapshot.ts`：文本序列化跳过双宽字符占位格。
- 两层都加入 CJK 回归测试；真实 PTY 测试覆盖当前屏幕与 scrollback。
- `docs/terminal-performance.md` 记录 cell-width 不变量。

## 验证与执行记录

- Protocol + Server focused tests：55 passed / 3 skipped。
- Targeted lint：通过。
- 重建 app dependencies 后 root typecheck：通过。
- 原坏法由测试明确断言 `中文ab`、`编号 40 结束` 等输出中不存在 `中 文` 或 `编 号`。
- 独立只读 review：0 P0 / 0 P1，确认 current grid、scrollback、alternate buffer 和旧 daemon wire 兼容路径正确。

## 关闭结论

- 判断：实现覆盖 current grid、scrollback 和 replay，原错误输出由回归测试锁定，可以关闭。
- 验证：focused tests、root static gates 与独立 review 全部通过。
- 毕业：当前能力和长期边界已写入 `../spec/terminal.md`；工程约束同步到 `docs/terminal-performance.md`。
- 遗留：无。
