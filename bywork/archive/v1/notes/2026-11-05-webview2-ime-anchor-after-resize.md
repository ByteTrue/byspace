# WebView2 交互缩放或窗口重新激活后丢失 IME caret 锚点（候选框跳屏幕左上角）

> **读者：** 半年后搜到这条的人——先看结论，再看何时适用与细节。

---

**结论：** Windows 桌面客户端里，鼠标拖边框缩放窗口之后、或 alt+tab 切走再切回来之后，立刻用输入法打字，候选框会浮在屏幕左上角而不是光标处，且**不自愈**（要点别处再点回来才好）。这是 WebView2 宿主层的缺陷，不是前端焦点管理问题：缩放/失活后浏览器进程侧的 TSF 文本库丢了 caret 布局，`GetTextExt` 拿不到锚点，IME 退回默认位置（屏幕原点）。上游记录：[MicrosoftEdge/WebView2Feedback#5675](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675)。

**何时用：** 桌面客户端出现「打字时输入法候选框位置不对 / 疑似输入焦点丢失」，且**只在客户端复现、浏览器里正常**时。

**细节：**

- 触发条件是**真实拖拽缩放**（程序化 `SetWindowPos` 改尺寸不触发；真实移动窗口不触发），以及**窗口失活再激活**（alt+tab 切走再切回）。
- WebView2 重新激活宿主窗口时不会给页面发 DOM `focus`（Wails 已经用 `MoveFocus` 把原生焦点还给 WebView，但 TSF caret 布局不重建），所以护栏监听的是 Go 侧 `WindowActive` 转发的事件 `byspace:window-focus`，不是 `window.addEventListener("focus")`。
- Chrome / Edge 打开同一页面不复现，所以别在前端焦点逻辑里找原因。
- 已验证有效的护栏：窗口尺寸稳定后（防抖 120ms）或窗口重新获得焦点后，把当前可编辑元素重锚一次——`blur()` → **等 60ms** → `focus({preventScroll:true})` + 还原选区与滚动；WebView2 在后台丢了 DOM 焦点时，重锚还会把焦点放回最后编辑过的元素。用户先点了非编辑区域（拖选消息文本等）再切窗口时不能把焦点拉回编辑器，所以 pointerdown 落在非编辑元素上会清掉这个记忆。合成中不打断（等 `compositionend` 再补做），只在 Windows + Wails webview 启用。
- 实测**无效**的做法，别再试：同步 `blur()+focus()`、`setTimeout(0)`、只调 `focus()`、只挪 DOM 选区。所见即所得编辑器（ProseMirror 类）用 `setTimeout(0)` 够用，源码模式（CodeMirror 6）不够，所以统一钉 60ms。
- 重锚是合成焦点往返，不是用户退出编辑器。普通 `blur()` 会触发文件重命名等 commit-on-blur；恢复焦点也会触发 select-on-focus。必须隔离合成焦点事件、只通知 React 已恢复的焦点，再还原原选区（含反向选区）与滚动。用户点击别处后不能抢回焦点；连续 resize 保留最后一次待恢复状态。合成输入在重锚间隔开始时仍需恢复原编辑器。
- 2026-11-05 多轮 review 后用 jsdom 覆盖上述 DOM 行为；jsdom 的 `KeyboardEvent` 不会模拟真实按键的默认目标选择和文本插入，不能用它证明键盘输入路径。原生 WebView2 的 IME 候选框位置与真实合成输入仍以 Windows 真机为准。
- 上游修好后可以整段删除护栏：实现是独立模块，没有散落的兼容分支。

**相关：** `web/src/core/utils/ime-anchor.ts`（实现与注释）、`byissue/issues/2026-11-04-x-win-ime-candidate-top-left.md`（诊断与验证证据）。
