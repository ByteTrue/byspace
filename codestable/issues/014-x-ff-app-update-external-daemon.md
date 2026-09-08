---
id: "014"
type: ff
title: App 更新不再停止外部 daemon
status: closed
date: 2026-09-07
---

## 做了什么

用户通过 npm 独立启动 daemon 并在设置里关闭 manage built-in daemon 后,桌面客户端"安装更新"仍会执行 `byspace daemon stop --force`,把外部 daemon 连同其 agent 会话一起杀掉。

根因:`install_app_update` IPC 处理器无条件传入 `onBeforeQuit → stopDesktopDaemon("app_update")`,该路径只检查 daemon 是否在运行,不检查 pid 锁的 `desktopManaged` 标记,也不检查 `manageBuiltInDaemon` 设置。退出路径(`quit-lifecycle.ts`)有这两层门控,更新路径没有。

修复:新增 `stopDesktopManagedDaemonForAppUpdate()`,先查 `daemon.manageBuiltInDaemon` 设置、再查 `isDesktopManagedDaemonRunningSync()`(pid 锁 `desktopManaged === true`),两者任一不满足就跳过 stop;`install_app_update` 的 `onBeforeQuit` 改为调用它。macOS DMG 交接与 Windows NSIS `quitAndInstall` 两条安装路径共用此回调,一并修复。

## 改了哪些

- `packages/desktop/src/daemon/daemon-manager.ts` — 新增门控辅助函数,`install_app_update` 接线改为它
- `packages/desktop/src/daemon/daemon-manager.test.ts` — 新增 3 个测试:外部 daemon(无 pid 锁)不停、`manageBuiltInDaemon` 关闭时不停、desktop 托管 daemon 照常以 `app_update` 原因停止

## 怎样验证

- `npx vitest run src/daemon/daemon-manager.test.ts --bail=1` 14/14 通过
- `npm run typecheck`、`npm run lint` 干净

## 对 codestable/ 的影响

`codestable/spec/desktop-updates.md` 增加一句:更新安装前的 daemon 停止必须与退出路径同源门控(仅 desktop 托管 daemon)。spec 由本次 ff 同步更新。
