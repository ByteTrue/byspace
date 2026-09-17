---
kind: issue
title: "清理 034 审计的两项遗留：WS server 改名与 desktop 孤儿 i18n"
type: ff
status: closed
created: 2026-09-15
closed: 2026-09-15
---

# 清理 034 审计的两项遗留

## 做了什么

issue 034/035 收尾时记为「未在本批」的两项，加上扫描时新发现的同类残留：

1. **`VoiceAssistantWebSocketServer` → `DaemonWebSocketServer`**。voice 时代的历史命名，实为通用 WS server；仅包内引用（20 处，含 3 个测试文件与 3 条构造期错误文案），不经 `exports.ts` 对外，改名安全。
2. **desktop 孤儿 i18n（×9 语言）**：整个 `desktop.{daemon,settings,integrations}` 块、`settings.about.updates`、`settings.about.releaseChannel` 全部零消费（desktop updater/permission/daemon 控制面已随 issue 025 A3 退役），`resources.test.ts` 的 Batch 4S 断言与 `ko.desktop.daemon` 断言随之删除。i18n.md 台账保留历史条目，标注 key 已退役。
3. **tool catalog 的 voice 残参**：`enableVoiceTools` / `voiceOnly` 只有类型声明、无赋值方；`if (options.voiceOnly) return toCatalog()` 与函数末尾 `return toCatalog()` 等价，整块连同注释删除（`docs/data-model.md` 的「not the voice-only speak tool」措辞同步）。
4. **benchmark 的失效 env**：`scripts/benchmark-terminal-latency.ts` 仍在给 daemon 传 `PASEO_DICTATION_ENABLED=false` / `PASEO_VOICE_MODE_ENABLED=false`，而这两个 env 已无人读；删除，`docs/terminal-performance.md` 的「benchmark 禁用 Dictation/Voice Mode」句随之删除。
5. **`docs/architecture.md`** WSHello 示例里的 `capabilities?: { voice?, ... }` 改为反映现存字段。

保留不动：`releaseChannel` / `serviceUrlBehavior` 存储字段（删了会重置用户本地偏好，且无 UI 无行为）、protocol wire schema、`ServerCapabilities` 通道、`speak` 历史消息渲染（`SpeakMessage`）。

## 改了哪些

改名：`websocket-server.ts`、`websocket-server.{notifications,terminal-notifications,relay-reconnect}.test.ts`、`bootstrap.ts`。
i18n：`resources/{en,ar,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts` + `resources.test.ts`。
其余：`agent/tools/{types,paseo-tools}.ts`、`scripts/benchmark-terminal-latency.ts`、`docs/{i18n,data-model,terminal-performance,architecture}.md`。

## 怎么验证的

- server：`mcp-server / session / bootstrap.smoke / config` 287 通过；`websocket-server.{file-transfer,origin,notifications,terminal-notifications,relay-reconnect}` 46 通过；
- app：`i18n / keyboard / composer` 456 通过；
- `npm run build:server` 后 `npm run typecheck` 0 error；`npm run lint` 0/0；format 一致。
- 全仓扫描确认 `voiceOnly|enableVoiceTools|VoiceAssistant|wrapSpokenInput|beforeVoiceContent|canOpenBrowserTabs|resolveVoice|useDictation|VoiceSession|VoiceProvider|DictationOverlay` 在活代码中零命中。

## 顺手发现

- `websocket-server.liveness.e2e.test.ts` 的「resumed stale socket」用例在本工作区超时失败；已用 `git stash` 在干净树上复现同样失败，属既有 flaky / 环境问题，与本次改动无关。

## 对 byissue/ 的影响

- issue 034 的遗留项清零；退役面清单记忆（PROJECT_RULES #1782）已同步。
