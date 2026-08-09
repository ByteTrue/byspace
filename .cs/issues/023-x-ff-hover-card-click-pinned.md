---
kind: issue
title: "workspace hover 卡不再被鼠标点击 focus 钉住"
type: ff
status: closed
created: 2026-08-07
---

# workspace hover 卡不再被鼠标点击 focus 钉住

## 做了什么

hover 卡会被行的 focus 状态钉住常开（`triggerFocusedRef`，012c96df2 为键盘可达性加的）：Web 上鼠标点击同样会 focus 行内 RN Web Pressable，`onFocus` 冒泡到外层 View，导致点击行后浮窗不消失，直到点别处 blur。修复为只把键盘 focus（`:focus-visible`）当钉住条件；鼠标点击 focus 直接忽略，指针/安全区离开后 100ms 正常关闭。键盘 Tab focus 仍会开卡并钉住（可达性不变）。

## 改了哪些

- `packages/app/src/components/workspace-hover-card.tsx` — `handleTriggerFocus` 接收 `FocusEvent`，`nativeEvent.target` 不匹配 `:focus-visible` 时直接 return；补 `FocusEvent` 类型导入。

## 怎么验证

- 旧代码（生产 bundled UI）复现根因：hover 开卡 → 点击行、移开鼠标 → 卡常驻；此时 `document.activeElement` 正是该行 button 且 `:focus-visible` 为 false —— 钉住的就是鼠标点击 focus。
- 同浏览器验证谓词两侧：鼠标点击后 `:focus-visible`=false（新代码忽略该 focus）；键盘 Tab 后 =true（新代码保留钉住）。
- `npm run typecheck`、`npm run lint`、`npm run format` 全绿。
- 新 bundle 端到端未验证：dev bundle 被同工作区另一 agent 的未提交 WIP 语法错误挡住，生产 daemon 按设计拒绝跨 origin 的 dev app；待人工验收。

## 对 `.cs/` 的影响

docs/hover.md 增补一条 focus 相关失败模式：鼠标点击 focus 不得钉住 hover 浮窗。
