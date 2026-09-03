# 桌面更新

BySpace Desktop 从 GitHub Release manifest 检查和下载更新。用户手动点击安装时，当前平台负责把已经确认的新版本交给系统安装机制；更新失败不得提前停止 daemon 或关闭 App。

## macOS

macOS 不尝试原地替换正在运行的 App。发现新版本后，用户点击安装会触发以下流程：

1. 从当前 channel 的 manifest 选择与运行架构一致的 DMG。
2. 流式下载到 Downloads 中的临时文件，并校验 manifest 的 SHA-512。
3. 校验通过后原子写入最终 DMG，并在打开前清除其 `com.apple.quarantine` 扩展属性（`xattr -c`），确保挂载后拖拽覆盖的 App 不带隔离位。
4. 只有系统成功接受打开请求后，才停止 desktop daemon 并退出 BySpace。
5. 用户在 Finder 中把新 App 拖动覆盖旧版本（覆盖后可直接点击打开，无需每次手动执行 `sudo xattr -rc`）。

下载、校验或打开失败时，BySpace 保持运行并报告错误。普通退出不启动这条 DMG 流程，也不会与 Electron 的自动安装路径竞争。

每个正式或预发布 Desktop release 都必须在对应 mac manifest 中提供 arm64 和 x64 DMG 及 SHA-512。

## Windows 与 Linux

Windows 和受支持的 Linux 安装形态继续使用 Electron updater 的下载与 `quitAndInstall` 流程。macOS 的手动交接不能改变其他平台的下载、退出或重启参数。

## 外部链接处理

Desktop 主窗口（`mainWindow`）设置统一的 `setWindowOpenHandler`。无论用户在 Terminal（xterm web links）、Markdown 消息渲染还是界面其他区域点击 HTTP(S) 链接，均校验协议并统一调用系统默认浏览器（`shell.openExternal`）打开，彻底禁止 Electron 打开未受管理的子 BrowserWindow。

## 历史证据

- [macOS 更新改为 DMG 手动覆盖交接](../issues/002-x-macos-dmg-update-handoff.md)
- [Pi 启动注入项目信任并完善斜杠补全加载态与外部链接交接](../issues/004-x-pi-project-skills-and-autocomplete-loading.md)
- [macOS DMG 更新器自动清除 com.apple.quarantine 隔离属性](../issues/006-x-macos-dmg-updater-quarantine-strip.md)
