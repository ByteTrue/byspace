import assert from "node:assert/strict";
import test from "node:test";

import { runAudit } from "./go-parity-audit.mjs";

// `packages/protocol` 的功能字段几乎全是 `.optional()`：Go 端漏解析不会让
// `WSOutboundMessageSchema` 报错，只会在真实浏览器里静默退化（图片被丢弃、Chief 不置顶、
// 轮次状态不更新）。所以把「协议字段 ⇄ Go 解析」做成可执行断言，而不是靠人工逐条比对。

test("handles every inbound session message the protocol declares", () => {
  assert.deepEqual(runAudit().unrouted, []);
});

test("parses every documented field of handled inbound messages", () => {
  const rows = runAudit().inbound.map((r) => `${r.key}: ${r.missing.join(", ")}`);
  assert.deepEqual(rows, []);
});

test("fills every field of the outbound payloads it emits", () => {
  const rows = runAudit().outbound.map((r) => `${r.key}: ${r.missing.join(", ")}`);
  assert.deepEqual(rows, []);
});
