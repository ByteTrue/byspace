---
kind: issue
title: 完整客户端发行闸门与 v0.7.4 恢复发布
type: bug
status: open
created: 2026-08-27
---

# 完整客户端发行闸门与 v0.7.4 恢复发布

## 做成以后是什么样

每个 Stable/Beta tag 在 npm exact-SHA 发布成功后，除 Web/PWA 与 Relay 外，还从同一 tag 构建并发布完整的 Electron Desktop 与 Android 下载产物。GitHub Release 不再只有源码归档；发布技能必须等所有渠道与客户端资产齐全后才能宣布完成。

**发布面：**

- Electron Desktop：macOS arm64/x64 DMG + ZIP、Linux x64 AppImage/deb/rpm/tar.gz、Windows x64/arm64 installer + ZIP，以及对应更新元数据。
- Android：使用 BySpace 专用长期 release key 签名的 sideload APK。
- 完整性：`SHA256SUMS.txt` 与 machine-readable client release manifest 绑定 tag、commit、平台、架构、文件大小、SHA-256 与签名状态。
- iOS：保留共享源码、Expo prebuild、Native modules、测试、EAS/Fastlane 配置和上游同步覆盖；不进入 active CD，不构建、不提交商店、不上传 IPA，也不成为发布门禁。

**范围：** 包含客户端 workflow、exact-tag/幂等上传、Android signing、Release 资产、下载入口、发布/加固/上游同步 Skill、Project Spec/Vision/AGENTS 与相关 docs；不包含购买 Apple/Windows 证书、App Store/TestFlight、Google Play 商店发布、移动功能扩展或重打/移动 `v0.7.0`。

## 为什么现在做

`v0.7.0` 已正确发布 npm、Stable Web 与 Stable Relay，但 GitHub Release assets 为空。用户在完成 Native/Desktop 全量恢复后要求“全部收尾并发正式版本”，当前 playbook 却仍把公开发行解释成 npm/Web/Relay tuple，导致恢复完成的客户端没有进入发布动作；这是发行契约与用户意图不一致，不是客户端产物丢失。

冻结 Paseo `v0.5.1` 的 Native/Desktop 聚合审计已经证明 271/271 路径闭合。此次复核又确认客户端发布源码也已迁移，但 BySpace 有意移除了上游的 tag trigger：

- upstream `desktop-release.yml` 会在 release tag 构建并上传三平台产物；改造前的 BySpace 只允许 manual dispatch，且默认不 publish。
- upstream `android-apk-release.yml` 会在 tag 构建并上传 APK；改造前的 BySpace 只生成 Actions artifact，不写入 GitHub Release。
- 改造前 BySpace 的 iOS EAS workflows 仍处于可手动触发目录；这不符合用户再次确认的“只保留、CD 不发布 iOS”边界。

因此旧的“Desktop/Android 仅 internal/dormant、当前正式发行只有 Web/npm/Relay”已不再是当前产品事实。历史 Issue 保留当时证据，但必须追加 superseded 指引；Project Spec、Vision、docs、Skills、网站和 workflow 必须统一为新边界。

## 质量承诺

- **功能适宜性：** Release 页面必须真实出现所有声明的 Desktop/Android 文件；下载后的 Desktop 可启动，Android APK 可验证证书并安装；iOS 资产必须为 0。
- **可靠性：** 只构建 immutable tag；自动发布必须继承 `Publish npm` 的 exact-SHA 成功证据；所有平台 build 成功后才进入上传阶段。重跑只能补齐缺失且逐字节一致的资产，不能 `--clobber` 已发布文件。
- **信息安全性：** Android 禁止 debug key；固定并验证 release certificate SHA-256。Secrets 不进入日志、artifact 或仓库。无 Apple/Windows 证书时，macOS ad-hoc/Windows unsigned 状态必须进入 manifest、Release notes 与下载说明，不能伪称 notarized/AuthentiCode signed。
- **可维护性：** Stable/Beta、failed-job retry 与文档读取同一 release tuple；静态测试阻止恢复 `checkout_ref`、`--clobber`、debug-signed Android、active iOS publish 或 Web-only 完成声明。
- **兼容性：** `v0.7.0` 至 `v0.7.3` 的 tag/资产均不移动。`v0.7.1`、`v0.7.2`、`v0.7.3` 的客户端矩阵都在资产上传前失败；通过 `v0.7.4` fix-forward 完成全量发行。Stable/Beta Web、Relay、npm 与 Desktop update channel 继续隔离。

## 实现安排

1. 把 Desktop 与 Android 合并为一个只由 `v*` tag 触发的 `Publish clients` workflow：先校验 immutable tag、当前 `origin/main` 与 exact-SHA push CI。恢复只允许在原 run 内 retry failed jobs，不能从其他 workflow revision 重建旧 tag。
2. 各平台只上传 Actions artifact；最终 job 等待 npm workflow 创建 GitHub Release，下载全部平台输出、合并 update metadata、生成 checksums/manifest，再只新增资产或接受逐字节相同资产。删除任意 ref 构建与 `--clobber`。
3. Android prebuild 后用专用 release key 运行 Gradle `assembleRelease`，通过 `apksigner` 校验证书指纹；key 仅保存为本机受限备份和 GitHub Actions Secrets。
4. 将 iOS EAS workflow definitions 移出 active workflow directory并标为 inactive reference source；active GitHub/EAS CD 不得包含 iOS build/submit。Fastlane、EAS profiles、prebuild 和测试保留。
5. 更新所有当前事实入口与 release Skills；历史关闭文档追加新发行 Issue 链接，所有 current-source-of-truth 文档只陈述新边界。
6. 本地完成三平台/Android 可执行验证与完整 release gate；`v0.7.1` 至 `v0.7.3` 的首次真实 tag 矩阵暴露 CI/打包机械缺陷后，均不修改旧 tag，通过 `v0.7.4` fix-forward，等待 npm/Web/Relay/Clients 全部完成并做真实安装验证。

## v0.7.1 / v0.7.2 / v0.7.3 客户端发布事故与恢复

`v0.7.1` 的 npm、Stable Web 与 Stable Relay 已成功，但 `Publish clients` 首次真实矩阵在任何 Release asset 上传前失败：

- macOS/Linux/Windows 的 Electron Web export 错把 `build:web` 发给 Desktop workspace；该 workspace 不存在此 script。
- Windows job 在 `npm ci` 前把 npm `script-shell` 改成 Windows PowerShell，导致 `node-pty` install script 中的 `||` 无法解析。
- Android 与其他 job 的输出只属于失败 run 的临时 Actions artifacts；聚合 publish job 未运行，GitHub Release 没有不完整客户端资产。

恢复采用 `v0.7.2` fix-forward：提取唯一的 `build:desktop:web` 根脚本供本地与三个 CI 平台共用，移除 Windows npm shell 改写，并以静态回归测试锁定两条约束。禁止移动 `v0.7.1` tag，也禁止用新 workflow revision 重建旧 tag。

`v0.7.2` 再次停在任何客户端资产上传之前：Desktop workflow 仍引用不存在的 `build:server:runtime` 与 `build:desktop:main` 根脚本；npm 包已发布成功，但 registry 元数据先于 tarball CDN 可用，60 秒下载窗口返回 404，使首次 post-publish verification 失败。相同 tag 的 npm failed-job retry 在 tarball 可用后完成，并触发 Stable Web/Relay；没有重复 publish。

`v0.7.3` fix-forward 为 runtime/main 建立受测试的根脚本并由 macOS/Linux/Windows 共用，同时把 npm tarball 可用性等待扩展到 6 分钟。`v0.7.2` tag 保持不动，失败客户端 run 被取消且 publish job 从未启动。

`v0.7.3` 的 npm、Stable Web 与 Stable Relay 已成功，但客户端矩阵仍在聚合上传前停止：

- macOS job-level 空 `CSC_LINK` 被 electron-builder 当成项目目录路径，导致 ad-hoc 模式在打包时失败。
- Linux/Windows packaged smoke 仍向 CLI 传递已经删除的 `--no-inject-mcp`，CLI 在 daemon 启动前拒绝参数。
- Windows arm64 原生 runner 用 arm64 Node 执行 `npm ci`，但依赖中的 `workerd` 不支持 Windows arm64 开发主机。
- Android runner 在 emulator boot 期间收到 GitHub-hosted runner shutdown；未产生 APK 或代码级 Gradle 失败证据。
- 修正 smoke 参数后，本机真实 macOS package 又穿刺出 CLI `daemon status --json` 遗漏 PID lock 中 `desktopManaged` 的契约缺口；Desktop 已启动 daemon 却被报告为非 Desktop managed。

`v0.7.4` fix-forward 将可选 Apple 凭据限制在步骤内并在调用 electron-builder 前清除空变量，删除过期 CLI 参数，恢复 `desktopManaged` JSON 字段并加集成测试；Windows 两种目标统一使用可在 Windows arm64 上仿真运行的 x64 Node 构建工具链，产出的 arm64 App 仍在原生 arm64 runner 上 smoke。`v0.7.3` tag 与失败 run 保持不动，publish job 未启动。

## 验证

- 静态/单元：release workflow、channel isolation、release metadata、Android signing config plugin、active-iOS-absence tests。
- 本机构建：Desktop macOS package；Android release APK + `apksigner verify --print-certs`；Web export；typecheck/lint/format/diff。
- CI 穿刺：workflow 静态契约、本机 macOS package（含真实 renderer、Desktop-managed daemon、CLI status、terminal）和 Android 产物验证与 exact-SHA 主 CI 先通过；`v0.7.4` tag 端到端执行 macOS/Linux/Windows/Android publisher。客户端工作流不提供绕过上传的假发布模式。
- 发布：`v0.7.4` exact-SHA CI；npm latest、Stable Web、Stable Relay、Publish Clients 全绿。
- Release 资产：按 manifest 逐个下载、SHA-256 校验；macOS/Windows/Linux 启动 smoke；Android 安装/启动/Direct+Relay smoke；iOS asset/job/submit 为 0。
- 渠道：Beta npm/Web/Relay/Desktop 基线不变。
- 独立 Reviewer 只读审查 exact-tag/exact-SHA、anti-clobber、Android 固定证书签名、Desktop 五目标/updater、iOS active-CD 排除与 docs/skills/网站一致性：无 Blocker / High。

## 关闭时

- 回写 Project Spec、Vision、AGENTS、产品/架构/Android/开发/发行/上游同步文档与三个 release Skills。
- 关闭判断：公开 Release 资产、运行时 smoke、签名/校验、iOS exclusion 与 Stable/Beta 隔离均有可复核证据。
- 遗留：Apple Developer ID/notarization 与 Windows Authenticode 可在凭据到位后升级签名状态；iOS 仍永久不属于当前 CD，除非用户再次明确改变产品决定。
