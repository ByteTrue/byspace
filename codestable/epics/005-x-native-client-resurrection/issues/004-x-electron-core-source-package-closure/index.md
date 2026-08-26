---
kind: issue
title: "恢复 Electron 核心源码与可运行本地包"
type: feature
status: closed
created: 2026-08-26
updated: 2026-08-26
closed: 2026-08-26
---

# 恢复 Electron 核心源码与可运行本地包

## 做成以后是什么样

当前 BySpace shared App 能由 `packages/desktop` 作为可信 Electron 宿主加载。Desktop 可以启动或复用内置 daemon、通过 local socket transport 与它通信、打开共享 renderer，并通过 typed preload 使用基础窗口/文件/通知/设置能力；当前宿主可产出 unsigned/ad-hoc 的本地目录包并完成核心主旅程。

本 Issue 恢复 Paseo `v0.5.1` 的完整 Desktop package 源码和共享 App 的 Electron platform seam。Desktop package 内属于 Browser workbench 的源码不会被删除或假 stub，但 Browser tools/protocol/server 与端到端行为由下一 Issue 单独验收。

## 来源与边界

- 冻结来源：Paseo `v0.5.1` commit `f517493591a7b4072aa30ee48db13c1a51495103`、tree `fc096ff4bc53515c14a8e53d7d7adc6118f94974`。
- 永久标识：Electron `appId=com.bytetrue.byspace.desktop`、product/executable `BySpace`、scheme `byspace`。
- BySpace `main` 是产品事实来源；不得用上游 `packages/app`、daemon、release 或 renderer 整包覆盖当前实现。
- 只做显然唯一的机械适配：`@getpaseo/* → @bytetrue/byspace-*`、`PASEO_* → BYSPACE_*`、`.paseo → .byspace`、产品/URL/repo/CLI 名称、永久标识和当前 release-channel helper。
- 若 Browser、managed-daemon 或 updater 与当前 daemon/CLI/release 架构之间出现多种合理适配，停止该切片并报告，不自行设计兼容层。

## 包含

1. `packages/desktop` 当前完整源码、assets、typed preload、tests、dev scripts、Electron Builder config 与 package metadata。
2. managed daemon lifecycle、Node entrypoint launcher、runtime/package paths、local socket transport、quit lifecycle 与 Desktop settings。
3. App 的 `.electron` platform files、Desktop transport/attachment/editor/open-target seam，以及 renderer 启动所需的 shared platform wiring。
4. Root workspace、build/dev/version/lockfile wiring，以及 server-first Desktop build order。
5. 当前宿主 unsigned/ad-hoc `--dir` package 和隔离 `BYSPACE_HOME` runtime smoke。
6. Browser workbench package-internal源码保留并能编译；完整 Browser UI/protocol/server/tool 行为后续验收。

## 不包含

- Device Fabric、File Handoff、Phone Audio、虚拟麦克风或新跨设备协议。
- 用 Paseo marketing-site 替换现有 BySpace `packages/website`。
- 真实 code-sign/notarization、GitHub Release、Stable/Beta Desktop 发布或自动更新 rollout 执行。
- 修改主 daemon `6777`、用户生产 `~/.byspace` 或现有 Stable/Beta Web/Relay。

## 停止条件

1. 冻结上游 Desktop 在 server-first build order 下本身失败，先记录原始失败，不在 BySpace 中猜测修复。
2. 适配需要改变当前协议、daemon ownership、CLI auth、release exact-SHA 或 public channel 语义时停止。
3. 发现上游 credential、签名主体、App ID、GitHub owner/repo 或 production endpoint 无机械 BySpace 对应值时保持 fail-closed，并交由后续 release Issue。
4. 不得为了先编译而永久保留 `return false`/空数组/throw 的 Desktop 假 seam；每个被 shared App 调用的宿主 seam 必须有真实 `.electron` owner 或明确下一 Issue 的不可达边界。

## 验证

1. 冻结上游证据：server declarations → Desktop `build:main` → current-host `--dir` package 通过。
2. BySpace：`npm ci`、`build:server`、Desktop main/preload typecheck/build、shared App Web export 和 root typecheck/lint/format 通过。
3. Package residual scan 不含 `Paseo`、`@getpaseo`、`PASEO_*`、`sh.paseo`、`~/.paseo`、`paseo://`、上游 GitHub owner、上游 credential 或 signing material。
4. 产物 metadata 显示 `com.bytetrue.byspace.desktop`、`BySpace`、`byspace` scheme；未签名产物不声称公开可分发。
5. 隔离 Desktop 启动 managed daemon，经 local transport 加载 shared renderer；完成 Workspace/Agent/Terminal/文件/Settings 最小主旅程，并验证可连接其他 Host 的入口未被删除。
6. typed preload/IPC allowlist、sandbox/context isolation 和 attachment/editor/open-target 聚焦测试通过。
7. 独立只读审查确认纵向切片完整、适配机械、Browser 源码未被静默删除、公开发布边界未泄漏。

## 关闭时

- 回写 Epic 005：构建/package 路径、metadata、local transport/managed daemon smoke、残留 Browser checkpoint 和所有未打开发布闸门。
- 新建并激活 Desktop Browser + system integration closure Issue；不要把未完成的 Browser tool journey 混称为 Electron 已全部验收。

## 关闭证据

- Desktop focused tests：188 tests passed；Host runtime tests：104 tests passed。
- `npm run build:desktop` passed；生成 macOS arm64 `.app`、`.zip`、`.dmg`，产物 identity 为 `com.bytetrue.byspace.desktop` / `BySpace` / `byspace`。
- 真实 packaged smoke 验证两条安全路径：发现 6777 上未受 Desktop 管理的现有 daemon 时只复用、不接管；隔离 home 持久化 `daemon.listen=127.0.0.1:6769` 时，Desktop 启动 `desktopManaged=true` 的 managed daemon。
- 隔离 managed-daemon smoke 中 Desktop 正常退出（code 0），quit lifecycle 停止 6769 daemon；同期 6777 生产 daemon PID 保持不变。
- typed preload、local transport、attachment/editor/open-target、daemon lifecycle 与 package residual scan 通过；独立审查无 Blocker / High / Medium。
- Browser workbench 的完整行为没有混入本 Issue，已由 Issue 005 单独验收并关闭。

**本 Issue 已关闭。**
