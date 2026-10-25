import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handlerScopeFor, runAudit } from "./go-parity-audit.mjs";

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

// 一个消息可能出现在多行 case 列表的**续行**上（`"a",\n"b":`）。早先只认 `case "..."` 开头行，
// 于是续行上的消息拿不到作用域，它旁边的 struct 被判成「字段缺失」——或者更糟，真实的缺失被
// 判成已覆盖。这个断言锁住两种形状都能取到作用域。
test("finds the handler scope for a message on a multi-line case list", () => {
  const source = `
func (s *Server) handleSomething(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		RequestID   string \`json:"requestId"\`
		TargetDir   string \`json:"targetDirectory"\`
		CloneSource string \`json:"cloneSource"\`
	}
	_ = json.Unmarshal(raw, &base)

	switch msgType {
	case "a.request",
		"b.request",
		"target.request":
		s.handleForgeParityOps(ctx, sink, msgType, raw)
	}
}

func (s *Server) handleForgeParityOps(ctx context.Context, sink frameSink, msgType string, raw json.RawMessage) {
	var base struct {
		TargetDir string \`json:"targetDirectory"\`
	}
	_ = json.Unmarshal(raw, &base)
}
`;
  const scope = handlerScopeFor(source, "target.request");
  assert.ok(scope.includes("targetDirectory"), "the continuation line must reach its handler body");
});

// 作用域必须止于本函数内。早先一路找到下一个 `\n\tcase `，跨过函数边界后把别的 handler 的
// struct 也算了进来，于是字段对账的结果取决于函数顺序。
test("handler scope does not leak into the next function", () => {
  const source = `
func (s *Server) handleOne(ctx context.Context, sink frameSink, raw json.RawMessage) {
	switch msgType {
	case "mine.request":
		return
	}
}

func (s *Server) handleTwo(ctx context.Context, sink frameSink, raw json.RawMessage) {
	var req struct {
		Leaked string \`json:"leakedField"\`
	}
	_ = json.Unmarshal(raw, &req)
}
`;
  const scope = handlerScopeFor(source, "mine.request");
  assert.ok(!scope.includes("leakedField"), "the scope must stop at the function boundary");
});
