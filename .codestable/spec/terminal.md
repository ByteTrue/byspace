# Terminal

BySpace Terminal 同时支持实时输出、历史回放和断线恢复。用户在这些路径中看到的字符、颜色、换行和先后顺序必须一致；恢复不能改变原始命令输出。

## 快照与恢复

Daemon 从当前 xterm buffer 生成 scrollback 和 visible grid。两部分使用同一套 cell 提取规则，并按从旧到新的顺序交给客户端。客户端把快照恢复为 ANSI 后再进入普通 Terminal 渲染链路，不维护第二份文本模型。

双宽字符占用一个有字符的 cell 和一个 `width=0` 结构占位格。占位格不能序列化为普通空格，否则中文等字符在每次回放后都会把后续内容右移。新快照用空字符表达该占位并在 ANSI 渲染时跳过；旧 daemon 已发送的普通空格仍按原字节显示。

Alternate buffer、current grid 和 scrollback 都遵守同一 active-buffer 规则。行截断、wrapped 标记和 scrollback 上限必须保持一一对应。

## 边界

- 字体、字号、主题和语法高亮属于 Appearance，不由快照恢复逻辑调整。
- Native renderer 可以用精确 cell 几何绘制 block 或 box glyph，但复制、选择和快照仍保留原 Unicode。
- Terminal 管线的背压、revision resume 和输出预算约束见 `docs/terminal-performance.md`。

## 历史证据

- [Terminal 中文快照回放间距](../issues/001-x-terminal-cjk-snapshot-spacing.md)
