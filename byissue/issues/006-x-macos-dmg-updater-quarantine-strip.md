---
kind: issue
title: "macOS DMG 更新器自动清除 com.apple.quarantine 隔离属性"
type: bug
status: closed
created: 2026-09-02
closed: 2026-09-02
---

# macOS DMG 更新器自动清除 com.apple.quarantine 隔离属性

## 做成以后是什么样

- 桌面客户端检查到更新并下载最新 `.dmg` 后，在 SHA-512 校验通过并调用系统打开该 DMG 之前，自动在本地执行 `xattr -c <destinationPath>` 清除该 DMG 文件的 `com.apple.quarantine` 扩展属性；
- 系统挂载出来的 DMG 文件卷无隔离标记，用户将 `BySpace.app` 拖入 `/Applications` 覆盖安装后，新 App 不会继承隔离位；
- 覆盖安装完成后，用户可直接点击运行新版 BySpace，无需每次手动在终端输入 `sudo xattr -rc /Applications/BySpace.app`。

## 为什么现在做 / 当前坏在哪

- 开源自建发布的 macOS 应用未经苹果付费开发者证书签名和公证，从网络下载 DMG 时 macOS 会自动对其添加 `com.apple.quarantine` 属性；
- 当用户挂载带有隔离属性的 DMG 并将 `BySpace.app` 拖入 `/Applications` 进行覆盖安装时，macOS Finder 会将 DMG 的 `com.apple.quarantine` 属性连带拷贝覆盖到 `/Applications/BySpace.app`，导致每次客户端更新覆盖安装后 Gatekeeper 都会拦截应用，强迫用户每次都必须在终端执行 `sudo xattr -rc` 才能重新打开。

## 方案与实现安排

1. **MacDmgInstallerDeps 接口**：
   - 增加 `stripQuarantine?(filePath: string): Promise<void>` 依赖项；
2. **downloadAndOpenMacDmg**：
   - 下载与 SHA-512 校验完成并将临时文件重命名至目标路径后，在调用 `deps.openPath` 前优先调用 `deps.stripQuarantine(destinationPath)`；
   - 异常捕获保证即使 `xattr` 执行失败也不会阻塞正常的 DMG 打开流程；
3. **auto-updater.ts**：
   - 实现 `stripMacQuarantineAttribute`，在 macOS 平台下通过 `execFile("xattr", ["-c", filePath])` 清除隔离属性（因文件在当前用户 `~/Downloads` 目录下，文件所有者为当前用户，无需 `sudo`）；
   - 在 `manualInstaller.open` 中注入该处理函数。

## 验证与事实

- `packages/desktop/src/features/mac-dmg-updater.test.ts` 新增单元测试用例，覆盖下载后成功清除隔离属性以及异常容错；
- 47 个桌面端测试文件共 367 个单测全绿；
- 全工程 `typecheck`、`lint`、`format:check` 全绿。
