---
kind: issue
title: "手机、PWA、客户端：桌面窗口和 Android 用新前端，手机手势，PWA"
type: feature
created: 2026-11-02
---

# 手机、PWA、客户端：桌面窗口和 Android 用新前端，手机手势，PWA

## 目标与范围

新前端在浏览器里已和旧版对等（第 1–4 步）。这一步让它在旧版跑的其它外壳里也对等：Wails 桌面窗口、Android 客户端、手机浏览器和装到主屏的 PWA。对照基线仍是旧版在同一个外壳里的实际行为。分批做，每批一个提交：

1. **桌面客户端（Wails）**：开发版桌面窗口改用新前端（`scripts/dev-desktop.mjs` 构建 `web/`，用 `BYSPACE_WEB_DIR` 指过去）。正式打包仍是旧版，第 6 步再切。窗口里才有的部分逐项验：自动连上本机 daemon（连接提示和本机凭据）、标题栏和红绿灯、拖动窗口和双击缩放、原生确认框、设置里的桌面专属行（更新、命令行工具、配置目录、开机启动、程序坞、保持唤醒、轻量模式、备份、接管 daemon）、外部链接、下载、拖文件、快捷键、剪贴板。
2. **手机布局和手势**：侧栏和右侧面板的滑动手势、长按、软键盘弹出时的布局、安全区。
3. **PWA**：manifest、安装到主屏、推送；旧版的 service worker 只做推送、不做离线缓存（`packages/app/public/sw.js` 开头写明是有意的），保持一致。
4. **Android 客户端**：Wails v3 的 Android 包用新前端构建，装到设备上验。

## 验证

- 每批和旧版在同一个外壳里对照：桌面窗口两边各开一次（`BYSPACE_WEB_DIR` 分别指向新旧构建），截图放 `screenshots/对照全集/`。
- 每批涉及的操作在外壳里实际做一遍，结果写进执行记录；需要真实设备或账号而做不了的单独列出。
- `npm run typecheck`、`npm run lint`、`npm run format:check` 通过；动到 Go 时 `npm run audit` 通过。

## 执行记录

### 第 1 批：桌面窗口（进行中）

- `scripts/dev-desktop.mjs`：开发版桌面窗口默认加载 `web/dist`（启动前构建 `@bytetrue/web`），`BYSPACE_WEB_DIR=internal/webui/dist` 可切回旧版对照。正式打包不变。
- 已在窗口里实测、和旧版一致：自动连上本机 daemon（`wails://localhost`，连接提示带本机凭据）、桌面专属设置行（开机启动、程序坞、轻量模式写入 `desktop.json`、保持唤醒、关于页的更新/配置目录/命令行/诊断）、⌘K、文件树右键「Copy path」写入系统剪贴板、删除文件弹原生确认框（`/_byspace/desktop/confirm` → NSAlert，取消后文件仍在）。
- 窗口里 `window.confirm` 不弹框、直接返回 false（WKWebView 没有接 JavaScript 对话框），所以新旧前端都走 `/_byspace/desktop/confirm`，不能用 `window.confirm`。
- 发现：桌面窗口和 iOS Safari 都是 WebKit。新前端的文字行高是按 Chromium 调的，在 WebKit 里每行差 1px、往下累积（关于页「Connected hosts」比旧版高 5px）。旧版用 `line-height: normal` 的块级文字，新版是带固定行高的行内 `span`，两种引擎对后者的行盒算法不同。要用 WebKit 把第 4 步的文字位置扫描重跑一遍，统一改，不逐处补。
