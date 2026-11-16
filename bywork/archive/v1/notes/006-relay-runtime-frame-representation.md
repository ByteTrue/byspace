# 006：同一份 relay 源码，两个 runtime 的帧表示不同

> **读者：** 给 relay 写跨 runtime 代码的人（Node 容器 / Cloudflare Worker / 未来第三种），或调试「本地好好的、线上握手失败」的人。
> **自检：** 一句话结论 · 何时用 · 两个 runtime 的差异 · 坑 · 相关代码位置。

---

**结论：** WebSocket 消息的**帧类型不体现在值上**。Node 的 `ws` 把文本帧也给成 `Buffer`，类型信息在回调的第二个参数 `isBinary` 里；Cloudflare 的 `webSocketMessage(ws, message: string | ArrayBuffer)` 则用 `string` vs `ArrayBuffer` 直接表示。所以**「不是 string 就是二进制」这条推断在 Node 上恒假**——它把每一帧文本都当二进制转发。

**何时用：** relay 里任何转发、判断、缓冲 WebSocket 帧的地方；新增第三种 relay runtime 时；线上握手在自托管 Node relay 上失败而 CF 版正常时。

## 两个 runtime 的差异

|                                              | 文本帧到达时 | 二进制帧到达时 | 判据                          |
| -------------------------------------------- | ------------ | -------------- | ----------------------------- |
| Node `ws`（`node-adapter.ts`）               | `Buffer`     | `Buffer`       | 回调第二参数 `isBinary`       |
| Cloudflare Worker（`cloudflare-adapter.ts`） | `string`     | `ArrayBuffer`  | `typeof message === "string"` |

`cloudflare-adapter.ts` 的 `webSocketMessage(ws, message: string | ArrayBuffer)` 与 `bufferFrame(connectionId, message: string | ArrayBuffer)` 就是按值类型走的，在 workerd 上成立；把同一份逻辑照抄到 Node 会静默坏掉。

## 坑

- **症状不指向根因。** 帧类型被改写的表现是握手失败：daemon 报 `relay_e2ee_handshake_failed` / `Invalid hello message (receivedType=undefined, hasKey=false, preview="<binary frame>")`，relay 随后给浏览器 `close(1012, "Server disconnected")`，弹窗只显示 `Server disconnected`。看到「握手失败」要先怀疑帧被改过，而不是密钥或协议版本。
- **失败只在文本帧上暴露。** 二进制帧转错了仍然「看起来对」（内容一致，只是壳变了一层），所以本地跑一段加密流量会以为没事——握手帧是明文文本，才是唯一的探针。
- **不要靠值猜类型。** `Buffer.from(x).toString("utf8")` 对二进制帧也会成功，得到乱码而不报错。判据只能来自 runtime 给的标志：Node 传 `isBinary`，workerd 用 `typeof`。
- **统一两个 runtime 的抽象层很贵。** CF 的 tag/attachment API 与 `ws` 差异大，强行收进一个内核会引入序列化边界。当前做法是两个 adapter 各自实现 + `node-relay-e2e.test.ts` 断言 parity，契约写在 `docs/protocol-compatibility.md` 的 Relay wire compatibility 节。

## 相关位置

- `packages/relay/src/node-adapter.ts`：`ws.on("message", (message, isBinary) => ...)` 两处（v1 / v2），统一走 `normalizeIncoming(message, isBinary)`；`normalizeIncoming` 按 `isBinary` 分流成 `string` 或 `ArrayBuffer`。
- `packages/relay/src/cloudflare-adapter.ts`：`webSocketMessage(ws, message: string | ArrayBuffer)`，按值类型分流。
- `packages/relay/src/node-relay-e2e.test.ts`：帧类型保真用例（文本进文本出、二进制进二进制出）。
- `docs/protocol-compatibility.md`：Relay wire compatibility — 帧类型是契约的一部分。
- issue 061 执行记录：本坑的发现与修复过程。
