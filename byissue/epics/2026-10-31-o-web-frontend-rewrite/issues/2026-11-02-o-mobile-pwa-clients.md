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

### 第 2 批：手机布局和手势（进行中）

- 侧栏和文件面板改用旧版的做法：一个共享位置（-1 侧栏、0 页面、1 文件面板）同时驱动两个面板和背后的遮罩，面板占满屏幕宽、从边上滑进来，220ms，曲线同旧版（`cubic-bezier(0.25, 0.1, 0.25, 1)`）。状态机和手势判定直接用旧版的 `mobile-panels/model.ts`、`gesture-intent.ts`，只把 Reanimated 换成直接写 DOM 样式（`web/src/overrides/mobile-panels/`）。原来是两个 shadcn Sheet：打开时只淡入加右移 40px，也不能拖。
- 手势同旧版的四个：从左边缘 32px 内向右拖打开侧栏，从右边缘向左拖打开文件面板，在打开的面板上反向拖关上；面板跟手，松手时拖过三分之一屏宽或甩动超过 500px/s 就完成，否则弹回；开始于横向滚动过的内容上的右滑不算（让它滚回去）；终端有选区时不响应打开手势。鼠标拖动也行（旧版的 gesture-handler 也接受鼠标）。
- 和旧版不同、有意的：旧版网页的两个打开手势不响应触摸（`touch-action: auto`，浏览器把横向拖动当成平移接走了，只有鼠标拖动能打开），两个关闭手势（`pan-y`）能用。新版用触摸事件实现，确认横向后阻止页面滚动，打开也能用手指拖。在 Android 模拟器的客户端里实测：旧版从左边缘向右拖不打开、在打开的侧栏上向左拖能关上；新版两个都能。（Chrome 桌面的触摸模拟里旧版关闭手势也没反应，是模拟的问题，以模拟器为准。）Android 用手势导航时，屏幕两边的边缘滑动是系统的返回手势，新旧版的打开手势都拿不到，三键导航时才有用。
- 顺带对齐：手机侧栏不显示提示卡片和开发版标签，同旧版的 `MobileSidebar`；终端有选区时屏蔽打开手势（移植终端时因为当时没有边缘手势而去掉了，现在恢复）。
- 提示条（toast）原来是验证阶段的临时实现：在窗口底部、带关闭按钮、没有动画。换成旧版的：头部下方（面板内的在面板顶部下 12px）、16px 圆角、按类型着色的边框、18px 图标、140ms 淡入并下移 8px、鼠标停在上面时暂停计时、没有关闭按钮。桌面上「Copied」提示条和旧版逐像素一致。
- 安全区：页面头部、图片查看器、图表全屏、出错页按 `env(safe-area-inset-*)` 留边，同旧版的 `useSafeAreaInsets`；装到 iPhone 主屏后不再画到状态栏下面。其余用到安全区的旧版文件逐个对过，网页版都已处理。
- 长按：抽出 `web/src/hooks/use-long-press.ts`（同 Pressable：按住 500ms、移动超过 10px 取消、松手那次点击不算）。历史行的长按归档改用它；右键菜单触发器重新转发 `onLongPress`（文件、文件夹行长按选中自己，移植时丢了）。手机上长按一行同时打开它的菜单面板：iOS Safari 不发 `contextmenu` 事件，旧版在 iPhone 上没有任何办法打开文件菜单（复制路径、重命名、删除等）；Android 长按两边都能打开。
- 浏览器历史（Android 返回键）：旧版切换工作区不增加历史记录——它把栈退回宿主页面再换工作区（`POP_TO`，宿主上面没有页面时 `dismissTo` 替换当前页），设置、历史等页面压在上面，从它们进工作区会先退掉。所以在工作区按返回（浏览器后退、Android 返回键）直接离开应用。新版移植时把工作区路由当成普通跳转，每次切换都加一条记录，返回会一个个退回去过的工作区。改成同旧版：`web/src/overrides/navigation/workspace-route-navigation.ts` 记录每条历史是不是宿主页（工作区、`/open-project`、`/`），工作区跳转先退到宿主那条再替换。验证（`history-paths.mjs`，桌面和手机）：打开 → 工作区 A → 工作区 B → 历史页 → 点 agent → 设置 → 后退 → 后退，每一步的历史长度和所在页面两边一样。
- 软键盘：旧版用的 `react-native-keyboard-controller` 在网页上不报告键盘，旧版网页从不为键盘移动布局，由浏览器自己调整；新版同样不处理。要在真机上看。
- 验证（390×844，Chrome 触摸模拟，脚本在 `screenshots/对照全集/_脚本/第5步/`）：长按（`long-press.mjs`）文件行按住 800ms 后选中并打开菜单面板，桌面上鼠标按住只选中、不打开文件，历史行按住弹出归档确认（旧版用触摸都没反应）；手势（`m-gestures.mjs`）：慢拖到一半时面板位置等于手指位移（旧版用鼠标拖时落后 2–3 帧），过三分之一松手打开、不到三分之一弹回、快速甩动打开和关闭、屏幕中间开始的拖动不触发；点按钮打开时每帧位置和旧版的曲线一致；打开后的侧栏、文件面板截图和旧版一致（侧栏除了第 2 步有意移进列表的 Search、Schedules、Tunnels）。

### 第 3 批：PWA

- `web/index.html` 原来缺了装到主屏需要的东西：manifest 链接、`apple-touch-icon`、主屏模式的 meta（全屏、标题、半透明状态栏）、`robots`，以及外壳的 `overflow: hidden` / `overscroll-behavior: none`（没有它 Android 上在顶部下拉会触发刷新，把应用重新加载）和深色主题下 JS 加载前的深色底。都换成旧版 `public/index.html` 的值。manifest、图标、`sw.js` 原来就由 `web/vite.config.ts` 从 `packages/app/public` 提供。
- 手机上锁定缩放：旧版根布局调用 `useCompactWebViewportZoomLock`（窄屏时 `maximum-scale=1, user-scalable=no`，防止 iOS 点进输入框时自动放大），第 2 步移植根布局时漏了，加到 `AppChrome`。
- 验证（`screenshots/对照全集/_脚本/第5步/pwa-probe.mjs`）：Chrome 的可安装性检查两边都没有错误，manifest 解析无错，运行后的全部 meta、link、外壳样式两边一致，JS 被拦下时深色主题的底色一致。
- 没验：真机安装到主屏（iOS 的状态栏留边、Android 的安装提示），推送沿用第 4 步已验的部分。
