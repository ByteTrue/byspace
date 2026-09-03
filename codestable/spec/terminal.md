# Terminal

BySpace Terminal 同时支持实时输出、历史回放和断线恢复。用户在这些路径中看到的字符、颜色、换行和先后顺序必须一致；恢复不能改变原始命令输出。

## 快照与恢复

Daemon 从当前 xterm buffer 生成 scrollback 和 visible grid。两部分使用同一套 cell 提取规则，并按从旧到新的顺序交给客户端。客户端把快照恢复为 ANSI 后再进入普通 Terminal 渲染链路，不维护第二份文本模型。

双宽字符占用一个有字符的 cell 和一个 `width=0` 结构占位格。占位格不能序列化为普通空格，否则中文等字符在每次回放后都会把后续内容右移。新快照用空字符表达该占位并在 ANSI 渲染时跳过；旧 daemon 已发送的普通空格仍按原字节显示。

Alternate buffer、current grid 和 scrollback 都遵守同一 active-buffer 规则。行截断、wrapped 标记和 scrollback 上限必须保持一一对应。

## 尺寸同步与首帧就绪

- 终端组件挂载时只在 WebGL 换装完成且测量出非零有效 fit 后才声明 `onRendererReady`；在就绪前不发起数据流订阅，确保首次发送的 `restore.size` 100% 为最终满宽几何，避免远程 PTY 收到未测量的初始尺寸导致会话被多次重新刷新（Resize Storm）。
- 挂载阶梯与布局过渡等被动尺寸变化统一通过 250ms 尾部合并窗口发送，用户交互驱动的尺寸变化保持即时发送。

## 外部链接与超链接

- Terminal 运行时同时加载 `WebLinksAddon`（纯文本 URL 正则识别）与显式 `linkHandler`（OSC 8 ANSI 富文本超链接）。
- 终端中点击任意外部链接直接统一路由至应用级 `onOpenExternalUrl` 链路，禁止触发 xterm 原生危险确认弹窗，桌面端交由系统默认浏览器打开。

## 边界

- 字体、字号、主题和语法高亮属于 Appearance，不由快照恢复逻辑调整。
- Native renderer 可以用精确 cell 几何绘制 block 或 box glyph，但复制、选择和快照仍保留原 Unicode。
- Terminal 管线的背压、revision resume 和输出预算约束见 `docs/terminal-performance.md`。

## 历史证据

- [Terminal 中文快照回放间距](../issues/001-x-terminal-cjk-snapshot-spacing.md)
- [复原 Terminal 首帧 post-WebGL 尺寸就绪与 250ms 被动合并机制](../issues/005-x-terminal-remote-resize-storm-and-fit.md)
- [修复 Windows 下思考加载图标定格与终端 OSC 8 链接打开无反应](../issues/008-x-ff-synced-loader-and-terminal-osc8-links.md)
