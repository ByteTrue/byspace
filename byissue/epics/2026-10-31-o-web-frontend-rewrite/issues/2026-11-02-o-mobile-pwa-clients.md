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
- WebKit 行高（已修）：桌面窗口和 iOS Safari 都是 WebKit。Tailwind 的 `text-xs` 自带 `line-height: calc(1/0.75)`，12px 时算出 15.99…px，WebKit 向下取整成 15px，Chromium 取 16px，所以 WebKit 里每行小字矮 1px、往下累积（关于页「Connected hosts」比旧版高 5px）。旧版文字没有自己的行高（react-native-web 下是 `normal`），`web/src/index.css` 把 `--text-*--line-height` 全部改成 `normal`；旧版写了固定行高的两处（侧栏工作区标题 20px、下拉框的值 20px）补 `leading-5`。用 WebKit 和 Chromium 各把第 4 步的文字位置扫描（17 个页面 × 桌面/手机）重跑：两种引擎的剩余差异完全相同，都是已知的有意改动（侧栏顶部导航把列表下移 102px）和测量口径（按钮文字的盒子就是按钮本身）。
- 顺带对齐（扫描和窗口截图对比里发现的旧差异）：侧栏工作区行的第二行（分支、主机、PR、检查）离标题 2px 改 0，项目之间 4px 改 6px、图标和文字 4px 改 3px，同旧版；提示框（Alert）改回旧版的 14px 圆角、12/16 内边距、14px 图标、透明底（只在浏览器不支持推送等情况出现，第 4 步扫描时没出现过）；次要按钮的文字从 shadcn 的 #171717 改回旧版的前景色 #0a0a0a（深色主题两者一样）。
- 窗口截图逐像素对比（1440×900，旧版和新版各在窗口里打开同一页）：设置通用页、关于页、主机概览只剩红绿灯的焦点状态（截图时窗口在后台）和 1px 的图标抗锯齿差异，约 0.04% 像素。
- 拖动窗口：窗口顶部 38px 内哪些点能拖、哪些点是按钮，用 WebKit 逐点比对新旧版，一致；唯一差别是旧版左上角的「BySpace ⌄」菜单在新版已去掉（第 2 步的有意改动），那里现在能拖。没有用真实鼠标拖动和双击缩放（你在用电脑，模拟鼠标会抢你的指针），留给验收。
