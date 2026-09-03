---
kind: issue
title: "macOS 更新改为 DMG 手动覆盖交接"
type: feature
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# macOS 更新改为 DMG 手动覆盖交接

## 做成以后是什么样

macOS 用户点击安装更新后，BySpace 下载当前 CPU 架构的 DMG，校验 release manifest 中的 SHA-512，保存到 Downloads，自动打开 DMG，然后停止 daemon 并退出 App。用户在 Finder 中手动拖动覆盖旧版本。

**范围：** 只改变 macOS Desktop 的安装交接；Windows 和 Linux 保持现有 `electron-updater` 安装路径。打开 DMG 失败时不得停止 daemon 或退出 App。

## 为什么现在做 / 当前坏在哪

当前 macOS 流程下载 `latest-mac.yml` 默认选择的 ZIP，再调用 `quitAndInstall()`。上游 Paseo 和 BySpace 在当前发行形态下都不能可靠完成运行中 App 的原地替换。manifest 同时提供每个架构的 DMG 和 SHA-512，但现有 runtime 丢弃了这些信息。

## 方案与实现安排

- macOS 关闭 `electron-updater` 的自动 ZIP 下载；发现新版本后立即允许用户启动手动安装交接。
- 从已经通过 updater 验证的 update info 中选择 `arm64` 或 `x64` DMG。
- 下载到临时文件，SHA-512 校验通过后原子移动到 Downloads；然后调用 Electron `shell.openPath()`。
- 只有 DMG 成功打开后才执行 daemon stop callback 和 `app.quit()`。
- before-quit 路径识别 manual handoff，不再并发触发 ZIP 安装。
- `docs/release.md` 记录 DMG/manifest 发布约束。

## 验证与执行记录

- 新增 DMG asset 选择、下载、checksum、打开失败测试。
- Desktop updater focused tests：44 passed。
- Targeted lint、root typecheck：通过。
- 真实 `v0.10.0 latest-mac.yml` 已核实同时包含 arm64/x64 ZIP、DMG 及各自 SHA-512。
- 独立只读 review：0 P0 / 0 P1；下载超时/取消、异常 IPC 并发锁作为 P2 报告项，不扩入本次单用户基线。

## 关闭结论

- 判断：macOS 现在完成 DMG 选择、下载、校验、打开和退出交接；Windows/Linux 保持原流程，可以关闭。
- 验证：Desktop focused tests、macOS unsigned smoke package、root static gates 与独立 review 全部通过。
- 毕业：当前平台行为和发布约束已写入 `../spec/desktop-updates.md`；发布流程约束同步到 `docs/release.md`。
- 遗留：用户仍需在 Finder 中手动覆盖 App，这是批准的产品流程。
