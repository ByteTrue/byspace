---
kind: issue
title: "退役 server 侧 voice 运行时与 CLI voice onboard"
type: ff
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 退役 server 侧 voice 运行时与 CLI voice onboard

## 做了什么

审计（issue 034）的 C 批：voice 在 issue 025 C8 退役后，server 端只剩恒空 shim 与分发接线；另外发现两处审计清单外的活残留——`VoiceCallerContext` seam 已恒 null 但仍在 paseo-tools/create-agent 间传递死参数，CLI `byspace onboard` 仍会**交互询问「Enable voice features?」并写入无人读取的 config**，还在等待 daemon 时显示「Downloading speech model…」进度（daemon 已不下载任何模型）。

删除内容：

- server：`speech/`（6 文件）、`session/voice/voice-session.ts`、`voice-types/config/permission-policy`、session.ts 的 `voiceSession` 字段与权限自动放行块、websocket-server 两个恒 null 方法、config.ts 的 `resolveSpeechOverrideControlledPaths`（调用点恒传 null，整块不可达）；
- client：`setVoiceMode` / `sendVoiceAudioChunk` / dictation 流方法 / `abortRequest` / `audioPlayed`、`sendSessionMessageStrict`（唯一使用者）、相关常量与类型；
- 死 seam：`resolveCallerContext` → `callerContext` → `lockedCwd` / `allowCustomCwd` / `childAgentDefaultLabels` 全链（含 `resolveChildAgentCwd` 的两个副本瘦身、create-agent intent 的 labels 注入）；
- provider manifest：`voice?` 字段与 3 个 provider 的 voice 声明（无读取方，且不经 provider snapshot codec 上 wire）；
- CLI：`--voice` 选项、voice 询问与持久化、speech 下载进度解析；
- docs：data-model（env 表、OpenAI speech 配置段、config 形状示例）、architecture（能力与事件清单）、product、glossary（`beforeVoiceContent` 槽位）、providers（voice 示例）、timeline-sync；
- bootstrap 两条失真日志与 `buildServerCapabilities` 注释修正（实际是省略 block，不是报 disabled）。

**wire 兼容（COMPAT(voice)，remove after 2027-09-15）**：`dispatchVoiceAndControlMessage` 改名 `dispatchControlMessage`，voice/dictation 分支改为显式丢弃；`set_voice_mode` 因 0.13 客户端会 await 响应（此前 shim 不响应 = 永久挂起），现在回一条 `accepted: false` 的拒绝响应。protocol 的 voice/dictation wire schema、`operation-permissions` 条目、`persisted-config` 的 `features.dictation/voiceMode` 与 `providers.*.stt/tts`（strict schema，删了会让老 config.json 加载失败）、`ServerCapabilitiesSchema` 全部保留。

## 怎么验证的

- server：`config / persisted-config / daemon-config-store / mcp-server / create-agent / session / messages / bootstrap.smoke / mutable-provider-config-owner / selection-store` 全过（session+mcp+create+config 等合计 500+）；
- client：`daemon-client / index` 134 过；cli `reload` 3 过；app i18n parity 54 过；
- `npm run build:client` + `build:server` 后 `npm run typecheck` 0 error；`npm run lint` 0/0；format 一致。

## 顺手发现

- `VoiceAssistantWebSocketServer` 类名（20 处引用，含测试）是 Electron/voice 时代的历史命名，实为通用 WS server，改名跨包，未在本批处理。
- app i18n 的 `settings.about.updates` 等 desktop 子块已随 025 退役失效，属 desktop 面清理，未在本批处理。

## 对 byissue/ 的影响

- issue 034 关闭；退役 shim 清单记忆（PROJECT_RULES #1782）已同步。
