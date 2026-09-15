---
kind: issue
title: "退役面残留全面审计（browser/voice/hub/plugin/desktop）"
type: feature
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 退役面残留全面审计

## 背景

issue 025 架构整理后已出现两例 UI 入口漏网（browser tools 设置卡、Plugins 设置空入口）。本审计系统排查各退役面（browser automation / voice / hub / plugin / Electron desktop）的运行时残留、死 UI 入口、孤儿 i18n key，分级列出可删项与必须保留项。

## 发现（按风险与收益分级）

### A 级：恒死 UI 入口（用户可见，与已修两例同类）

- A1. **Browser 标签页入口群**（`getIsElectron()` 恒 false 门控）：
  - workspace header「新建浏览器标签」菜单项（`showCreateBrowserTab` 恒 false）
  - command center 的 new-browser 命令 + `canOpenBrowserTabs` capability 分支
  - 键盘快捷键 Cmd/Ctrl+Shift+B（`workspace-tab-target-browser`）
  - tab launcher 的 browser 目标（`showBrowser` 恒 false，属隐藏但代码在）
  - `workspace-screen.tsx` 三处 `createWorkspaceBrowser()` 调用路径 + resident-webviews/new-tab-requests shim 消费
  - `workspace-tabs` model/identity 的 `kind: "browser"` 运行时分支（wire 类型保留）
- A2. **Composer 语音面**（voice shim 群恒空，composer 的 dictation/realtime overlay 永不显示）：
  - `composer/input/input.tsx` 的 useDictation/DictationOverlay/RealtimeVoiceOverlay 接线
  - `_layout.tsx` 的 VoiceProvider 包装
  - `voice-context`/`use-dictation`/`dictation-controls`/`realtime-voice-overlay` shim 本体可随后删除

### B 级：孤儿 i18n key（零消费，纯体积）

- B1. `browser.*` 顶层块（Electron 浏览器 UI：unavailable/session/controls 等）
- B2. `voice.*` 顶层块
- B3. `dictation.*` 顶层块
- B4. `updates.*` 顶层块（desktop app updater UI）
- 以上 ×9 语言文件。

### C 级：server 侧死运行时（低价值、需谨慎，建议单独批次）

- C1. voice：`speech/*` 六文件、`session/voice/voice-session.ts`、`voice-types/config/permission-policy`、session.ts 的 voice 分发分支、paseo-tools 的 VoiceCallerContext 残参（共 ~250 行 shim + 接线）
- C2. `websocket-server` 的 `resolveVoiceSpeakHandler`/`resolveVoiceCallerContext` 恒 null 方法

### 必须保留（审计确认为协议/活功能，不可删）

- protocol 全部 `voice.*`/`hub.*`/`plugin.*` 消息 schema 与 session.ts 的 retired 响应（wire 兼容既定行为）
- `server_info.features` 的 `plugins*` 旗标（老客户端依赖门控协议；虽语义已死但去掉会改变老客户端行为——与「protocol 不收缩」一致）
- `src/plugins/` 其余 shim（client-slash-commands/workspace-panels/icons/registry）——被活代码（autocomplete/panels/workspace-screen）引用
- `desktop/components/pair-device-*`：配对是 relay 活功能，仅目录名遗留（可改名，非本批）
- `desktop/daemon|updates|settings|pick-directory|hooks` shim：被 startup/settings 流程引用，恒空但为类型通路，删除需连带改造调用方（收益低）
- `.electron.*` 文件变体：已确认为 0 个，无需处理

## 处置建议

1. 立即批：A1 browser 标签入口群 + A2 composer 语音面（UI 死分支，收益直观）
2. 立即批：B 级 i18n 孤儿（纯删除）
3. 后续批：C 级 server voice shim（动 server 运行时，单独验证）

## 执行状态

### A + B 已完成（commit 56dc4188f，42 文件 +105/−3412）

A1 browser 标签入口群、A2 composer 语音面（含键盘 voice/dictation 动作、`useDictation`/`useVoiceOptional`/`useIsDictationReady`/`DictationOverlay`/`RealtimeVoiceOverlay`/`voice-context` shim 本体删除）、B 级 i18n ×9 语言全部清除。附带发现并处理：`serviceUrlBehavior` 设置项——「in-app」行为的唯一实现就是 browser tab，设置行已删（存储字段保留，不重置用户偏好），`openServiceUrl` 恒定走 external。

审计期间确认保留（不可删）：`SpeakMessage`（渲染历史 speak 工具调用）、workspace tab 的 `kind: "browser"` 标签回退与 tab model 分支（存量持久化 tab）、protocol 全部 wire schema、`src/plugins/` 其余 shim、`pair-device` 组件。

验证：composer/keyboard/workspace-tabs/command-center/i18n/utils/appearance/settings 1193 测试通过；typecheck / lint / format 全绿。

### C 待处理（server voice shim，~250 行）

`speech/*` 六文件、`session/voice/voice-session.ts`、`voice-types/config/permission-policy`、session.ts 的 voice 分发分支、websocket-server 恒 null 方法、paseo-tools 的 `VoiceCallerContext` 残参。动 daemon 运行时，需单独批次与验证。
