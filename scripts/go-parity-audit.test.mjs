import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runAudit } from "./go-parity-audit.mjs";

// The remaining inbound gaps are all in subsystems this build does not implement (hub.*,
// plugin.*, and a few optional fields). They are tracked by a baseline that is only allowed to
// shrink, so a run cannot hide a new gap by moving the number.
const baseline = JSON.parse(
  readFileSync(new URL("./audit-baseline.json", import.meta.url), "utf8"),
);

// `packages/protocol` 的功能字段几乎全是 `.optional()`：Go 端漏解析不会让
// `WSOutboundMessageSchema` 报错，只会在真实浏览器里静默退化（图片被丢弃、Chief 不置顶、
// 轮次状态不更新）。所以把「协议字段 ⇄ Go 解析」做成可执行断言，而不是靠人工逐条比对。

test("handles every inbound session message the protocol declares", () => {
  assert.deepEqual(runAudit().unrouted, []);
});

test("parses every documented field of handled inbound messages", () => {
  const rows = runAudit().inbound.map((r) => `${r.key}: ${r.missing.join(", ")}`);
  assert.ok(
    rows.length <= baseline.inboundGaps,
    `inbound gaps grew to ${rows.length} (baseline ${baseline.inboundGaps}); ` +
      `a new field is being dropped instead of parsed:\n${rows.join("\n")}`,
  );
});

test("fills every field of the outbound payloads it emits", () => {
  const rows = runAudit().outbound.map((r) => `${r.key}: ${r.missing.join(", ")}`);
  assert.deepEqual(rows, []);
});

test("parsed-but-ignored backlog does not grow silently", () => {
  // 这批字段属于 hub.*/plugin.*/worktree 等尚未实现的子系统，暂列 advisory；
  // 但数量只允许下降——涨了说明又加了 struct 却没接线。
  const { ignored } = runAudit();
  assert.ok(
    ignored.length <= 28,
    `parsed-but-ignored grew to ${ignored.length}: ${ignored.map((r) => r.field).join(", ")}`,
  );
});
