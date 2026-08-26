---
kind: issue
title: "重置完整客户端表面与上游同步边界"
type: chore
status: closed
created: 2026-08-26
closed: 2026-08-26
---

# 重置完整客户端表面与上游同步边界

> **当前发行状态（2026-08-27）：** 本 Issue 的发布凭据后置决定只描述 Epic 005 当时的恢复阶段，已由 [Issue 050](../../../../issues/050-o-full-client-release-gate/index.md) 取代。当前 Stable/Beta 必须发布 Android 与 Electron Desktop；Android v1 更新密钥已配置，Desktop 在平台凭据存在时执行原生签名，iOS 保持 no-publish CD。

## 为什么必须重置

用户确认旧 Web-only 裁剪一起去掉的受维护原生/桌面内容大体都应恢复，并明确指出未来上游同步规则也不能继续把这些内容默认排除。此前审计 D4 把 Desktop Browser Automation 后置，仓库规则甚至禁止 `.native`、Electron、EAS 与原生依赖；这些规则会让 Epic 005 只恢复空壳，并在下一次上游同步再次漏掉完整客户端纵向切片。

本 Issue 只完成删除面盘点、产品 disposition 与规则重置，不直接移植 Electron/Browser 运行时代码。

## 证据基线

- 历史裁剪提交：`2fa0b387a3973c60650902cad6c12e18c3748ba7`。
- 该提交删除 545 个 tracked files、约 65k 行；其中包括 161 个 Electron Desktop package 文件、53 个 App Desktop/Electron renderer seam、33 个跨层 Browser automation/tools 文件、64 个 Expo native module/config-plugin 文件、13 个 App native platform 文件、4 个平台/release workflow、4 个 App E2E 文件、Nix/desktop packaging，以及 146 个 Paseo 独立 marketing-site 文件。
- 恢复来源继续冻结为 Paseo `v0.5.1` commit `f517493591a7b4072aa30ee48db13c1a51495103`、tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`；旧删除提交只用于证明范围，不能 revert。
- `v0.5.1` 的 `packages/desktop` 已增长到 183 tracked files，说明必须移植当前受维护纵向切片，不能恢复旧 `v0.2` 快照。

## 删除面 disposition

| 删除面                                                                              | 当前 disposition                                     | 验证闭包                                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 共享 Expo Native seam、原生模块、Android/iOS platform overrides                     | 已恢复（Issue 001）                                  | focused tests、Web export、Android/iOS prebuild、静态检查                                   |
| Android internal artifact 与 Direct/Relay 主旅程                                    | 已恢复（Issue 002）                                  | production variant APK + arm64 emulator smoke                                               |
| Electron main/preload/window/managed daemon/local transport                         | 恢复                                                 | Desktop source build、unsigned current-host package、managed-daemon/local-transport journey |
| Desktop Browser workbench、webview/CDP、Browser tools/protocol/server/tool wiring   | 恢复；原 D4 已撤销                                   | trusted input、snapshot、screenshot、logs、tool-call tests/smoke                            |
| Desktop OS integrations：dialog、notification、editor、file path、clipboard/menu 等 | 恢复                                                 | typed preload broker tests + runtime smoke                                                  |
| auto-updater、Stable/Beta rollout、Electron Builder、Nix 与跨平台 packaging source  | 恢复源码；公开发布休眠                               | static/build smoke，无旧标识/凭据，无未授权 trigger                                         |
| Android/iOS EAS/Fastlane/CI、F-Droid/profile 和原生/桌面 E2E                        | 恢复受维护源码；未开渠道休眠                         | config/static checks、available local source/prebuild smoke、CI ownership                   |
| Browser Web E2E 与共享 test support                                                 | 按现行共享旅程逐项恢复，不因旧删除归为 native 而省略 | upstream test provenance + BySpace journey coverage                                         |
| 用 Paseo marketing-site 替换现有 BySpace `packages/website`                         | 明确不恢复                                           | residual scan；当前 BySpace landing/Hosted Web 边界保持现状                                 |
| 旧 `v0.2` renderer、旧 Chat/Loops、已被 Dictation 取代的 Voice conversation/TTS     | 明确不恢复                                           | Project Spec 与 residual scan                                                               |
| 证书、签名 key、Apple/Google/Windows/macOS credential、真实商店/公开发布执行        | 不迁移；后续 release gate                            | secret/identifier scan + fail-closed dormant workflow                                       |

## 规则变化

1. `AGENTS.md` 的 Web-only 边界改为多客户端边界；公开发行状态不再决定源码是否受维护。
2. `docs/upstream-sync.md` 与同步 Skill 的 inventory、target proof、candidate audit、review 范围必须覆盖 Web、Android/iOS、Electron、Desktop Browser、测试、打包和发布源码。
3. 下一次 Paseo release sync 之前，先补齐同一 `v0.5.1` 冻结基线的全部受维护客户端 disposition；不能从一个仍缺 baseline 的原生树计算新 delta。
4. `docs/release.md` 与 release engineering 明确区分“受维护源码表面”和“当前公开 release tuple”；Native/Desktop 渠道没有单独 exact-artifact gate 时不得发布。
5. Project Spec、Vision、Epic 005 和已关闭审计记录显式标记 D4 被关闭后决策取代，避免历史文档继续指导错误实现。

## 完成结果

- 已完成历史删除面与 Paseo `v0.5.1` 当前平台面的分类，建立恢复/排除表。
- 已撤销仓库级 Web-only 禁令和同步 Skill 中的 Electron/native/Browser 默认排除。
- 已将 Desktop Browser、桌面 OS 集成、updater/rollout、原生/桌面测试、打包和休眠发布源码纳入 Epic 005 后续 checkpoints。
- 已保留小而明确的排除清单：Paseo marketing-site replacement、当前 Project Spec 已替代的旧产品路径、签名凭据与未经单独授权的真实公开发布执行。
