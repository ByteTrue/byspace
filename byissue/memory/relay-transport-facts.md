# Relay 传输与计费：外部事实

## 结论

- relay 硬帧上限 32 MiB（wire），检查在已部署的 CF worker 里，不在仓库代码中；错误文本 `Relay frame exceeds size limit`。E2EE +40B 再 base64 ×4/3 → 明文上限约 24 MiB；公式 `maxBase64EncryptedPlaintextByteLength` 在 `packages/relay/src/encrypted-channel.ts`。send_agent_message/create_agent 把文本 + 全部内联图片打进一帧；uploadFile 走 FileBegin/FileChunk/FileEnd 1 MiB 分块 → `<home>/uploads/<id>/<fileName>`。
- 帧表示按运行时不同：Node `ws` 的文本帧是 Buffer（类型在回调第二参 isBinary）；CF 是 string vs ArrayBuffer。「不是 string ⇒ binary」在 Node 上恒假。
- DO duration 按醒着的时间计费：acceptWebSocket（hibernation）vs websocket.Upgrade 同账号差 4000×（TS 4.1 ms/req vs Go 16.2 s/req）。tunnel 每帧 0.28 milli-GB-s；峰值日 9,080 次 AI 调用 = 免费额度 13%；字节输入占 96% 但帧数只占 5–13%。守卫 `scripts/relay-worker.test.mjs`。
- 延迟实测：本地 relay 2379 RPS / 62.7 MiB/s / p50 0.3ms；官方 CF relay p50 449ms（4 跳公网，edge LAX）。自托管近处 relay 是延迟解法；P2P 被 owner 否决（其网络环境下打洞从未成功）。
- 配额耗尽的表现：所有 WS 500 但 /health 200。

## 依据

- 类型：外部观察（CF 平台行为与实测数字）+ 用户决定（否决 P2P）。
- 被否决的相关方案：P2P 打洞（owner 网络下从未成功）；追上游 Paseo 解决延迟（上游冻结，见 product-scope）。
- 证据或复核方式：笔记 `byissue/archive/v1/notes/003-relay-frame-budget-and-large-payloads.md`、`006-relay-runtime-frame-representation.md`、`018-durable-object-billing-and-hibernation.md`、`008-tunnel-performance-and-relay-vs-p2p.md`；`byissue/archive/v1/spec/connection.md`（hosted deployment 节）；守卫 `scripts/relay-worker.test.mjs`。
- 适用条件：32 MiB 上限是部署侧配置，改 worker 配置会变；计费数字是 2026-10/11 实测，CF 定价变化需重测；延迟数字依赖测量时点的网络路径。

## 重访条件

- 部署 worker 的帧上限或计费模式变更。
- 大 payload 需求超过 ~24 MiB 明文（需要分块或改上限）。
- 自托管 relay 成为主路径后重测延迟。
