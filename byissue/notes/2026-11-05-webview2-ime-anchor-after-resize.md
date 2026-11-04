# WebView2 交互缩放后丢失 IME caret 锚点（候选框跳屏幕左上角）

> **读者：** 半年后搜到这条的人——先看结论，再看何时适用与细节。

---

**结论：** Windows 桌面客户端里，鼠标拖边框缩放窗口之后立刻用输入法打字，候选框会浮在屏幕左上角而不是光标处，且**不自愈**（要点别处再点回来才好）。这是 WebView2 宿主层的缺陷，不是前端焦点管理问题：缩放后浏览器进程侧的 TSF 文本库丢了 caret 布局，`GetTextExt` 拿不到锚点，IME 退回默认位置（屏幕原点）。上游记录：[MicrosoftEdge/WebView2Feedback#5675](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675)。

**何时用：** 桌面客户端出现「打字时输入法候选框位置不对 / 疑似输入焦点丢失」，且**只在客户端复现、浏览器里正常**时。

**细节：**

- 触发条件是**真实拖拽缩放**。程序化 `SetWindowPos` 改尺寸不触发；真实移动窗口也不触发。
- Chrome / Edge 打开同一页面不复现，所以别在前端焦点逻辑里找原因。
- 已验证有效的护栏：窗口尺寸稳定后（防抖 120ms）把当前可编辑元素重锚一次——`blur()` → **等 60ms** → `focus({preventScroll:true})` + 还原选区与滚动。合成中不打断（等 `compositionend` 再补做），只在 Windows + Wails webview 启用。
- 实测**无效**的做法，别再试：同步 `blur()+focus()`、`setTimeout(0)`、只调 `focus()`、只挪 DOM 选区。所见即所得编辑器（ProseMirror 类）用 `setTimeout(0)` 够用，源码模式（CodeMirror 6）不够，所以统一钉 60ms。
- 上游修好后可以整段删除护栏：实现是独立模块，没有散落的兼容分支。

**相关：** `web/src/core/utils/ime-anchor.ts`（实现与注释）、`byissue/issues/2026-11-04-x-win-ime-candidate-top-left.md`（诊断与验证证据）。
