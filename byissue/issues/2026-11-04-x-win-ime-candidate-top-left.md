---
kind: issue
title: "Windows 客户端 IME 候选框飞到屏幕左上角（resize 后）"
type: bug
created: 2026-11-04
---

# Windows 客户端 IME 候选框飞到屏幕左上角（resize 后）

## 预期 / 实际

- **预期**：输入法候选框跟随输入框光标。
- **实际**（2026-11-04 Windows 本机，用户截图）：客户端里光标还在输入框闪烁、文字能提交，但候选框浮在窗口左上角；点别处再点回来才恢复。Chrome 里开同一个 web 界面不复现。

## 根因

WebView2 上游 bug：[MicrosoftEdge/WebView2Feedback#5675](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675)——鼠标拖拽缩放宿主窗口后，浏览器进程侧 TSF 文本库丢失 caret 布局，`GetTextExt` 拿不到锚点，IME 退回默认位置（屏幕原点）。触发条件：真实拖拽缩放（程序化 SetWindowPos 不触发）；不自愈；Edge/Chrome 不复现。lanmark 项目在同一 stack 上验证过成因与修法（commit `ba451f0`，注释引用本上游 issue）。

## 修复

移植 lanmark 的护栏（`src/lib/ime-anchor.ts` → `web/src/core/utils/ime-anchor.ts`）：窗口尺寸稳定后（防抖 120ms）把当前可编辑元素重锚一次——`blur()` → 60ms → `focus({preventScroll:true})` + 还原选区与滚动；合成中不打断（等 compositionend 再补做）；只在 Windows + Wails webview 启用（`isWailsDesktopContainer()` + Windows UA）。他们实测同步 blur+focus、`setTimeout(0)`、只 focus、只挪选区全部无效，60ms 是下限。

上游修复后可整段删除（无 shim 必要，模块独立）。

## 影响面

- **必须改**：`web/src/core/utils/ime-anchor.ts`（新）、挂载点 `web/src/main.tsx` 或 app 根组件。
- **需要验**：mac/浏览器端零行为变化（护栏不启用）；护栏重锚不改变选区与滚动位置。
- **仍未知**：用户先前报告的「窗口焦点莫名丢失」是否同为 #5675 家族（拖拽缩放后焦点链异常），实现后一并观察。

## 验证

Windows 客户端：拖拽窗口边框缩放 → 立刻用拼音打字 → 候选框贴在光标下；合成中缩放不丢字；A/B（停用护栏）复现原坏法。`npx vitest run`（web/ 内）跑护栏单测。

## 执行记录

- 护栏已实现：`web/src/core/utils/ime-anchor.ts`（防抖 120ms → blur → 60ms → focus + 选区/滚动还原，合成中等待 compositionend，仅 Windows+Wails 启用），挂在 `web/src/main.tsx`。单测 5 例全绿（含合成中不打断、非编辑元素不动），typecheck / lint 绿。
- 2026-11-05：用户在 Windows 客户端真机确认——拖边框缩放后立刻拼音打字，候选框贴在光标下。上游 #5675 未修，护栏长期保留。

## 关闭结论

预期与实际差在：客户端里输入法候选框跳到屏幕左上角、文字仍能正常提交，浏览器里同页面正常。根因不在本仓代码：WebView2 宿主层在拖边框缩放后丢失 TSF caret 布局（上游 WebView2Feedback#5675）。修复为缩放稳定后重锚当前可编辑元素（`web/src/core/utils/ime-anchor.ts`）。

证据：上游 issue 定位 + 同缺陷外部项目的实测修法；单测 5 例（防抖、合成中不打断、选区与滚动不变、非编辑元素不动）；`npm run typecheck` / `lint` 绿；用户在 Windows 真机用原坏法（拖边框缩放 → 立即拼音打字）确认候选框回到光标下。

回写：长期约束 → `byissue/spec/index.md` 边界与考量；外部事实与已排除的修法 → `byissue/notes/2026-11-05-webview2-ime-anchor-after-resize.md`。

遗留：无。护栏在上游修复后可整段删除（独立模块，无散落的兼容分支）。
