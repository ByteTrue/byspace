#!/usr/bin/env node
/**
 * Go ⇄ Node 协议字段对账器。
 *
 * 为什么要它：`packages/protocol` 里大量功能字段是 `.optional()`，Go 端漏解析不会让
 * `WSOutboundMessageSchema.safeParse` 报错，但前端特性会静默退化（典型：图片附件被丢弃、
 * workspace labels 缺失导致 Chief 不置顶）。人工逐条比对会漏，所以把它写成可重复运行的检查。
 *
 * 两个方向：
 *   inbound  —— 客户端发来的 request schema 有哪些字段，Go handler 的 struct 有没有接住。
 *   outbound —— 守护进程发出的 payload schema 有哪些字段，Go 有没有真的填。
 *
 * 用法：node scripts/go-parity-audit.mjs [--json]
 * 退出码：0 无差异；1 有差异（用于 CI 或本地收尾自检）。
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const GO_SERVER_DIR = path.join(ROOT, "internal/server");
const GO_PI_DIR = path.join(ROOT, "internal/agent/pi");

/** 明确不打算实现的入站消息（语音/口述）。新增排除项必须在这里写明理由。 */
const INTENTIONALLY_UNSUPPORTED = new Map([
  [
    "audio_played",
    "voice was removed by decision (issue 025, 8d96875115); the message is logged and nothing is recorded",
  ],
  [
    "voice_audio_chunk",
    "voice mode is disabled; daemon replies set_voice_mode with accepted:false",
  ],
  ["dictation_stream_start", "dictation is a native-client feature; web build has no dictation UI"],
  ["dictation_stream_chunk", "dictation is a native-client feature; web build has no dictation UI"],
  [
    "dictation_stream_finish",
    "dictation is a native-client feature; web build has no dictation UI",
  ],
  [
    "dictation_stream_cancel",
    "dictation is a native-client feature; web build has no dictation UI",
  ],
  ["recording_state", "held by the client-side recorder only; daemon has no recorder state"],
  [
    "client_heartbeat",
    "presence telemetry from the app; daemon keeps no per-device presence store",
  ],
  [
    "session.events.set_subscription",
    "explicit event subscription is served by broadcast filtering, not a stored preference",
  ],
]);

/** 解析 `SessionInboundMessageSchema = z.discriminatedUnion("type", [...])` 的成员，得到权威入站集合。 */
export function parseInboundUnionMembers(source) {
  const start = source.indexOf("export const SessionInboundMessageSchema");
  if (start < 0) return new Set();
  const end = source.indexOf("]);", start);
  const block = source.slice(start, end);
  const members = new Set();
  for (const m of block.matchAll(/^\s+([A-Z]\w+Schema),$/gm)) members.add(m[1]);
  return members;
}

export function parseProtocolSchemas(source) {
  const lines = source.split("\n");
  const schemas = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^export const (\w+) = z\.object\(\{$/);
    if (!head) continue;
    let depth = 1;
    const fields = [];
    let typeName = null;
    let statusName = null;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const line = lines[j];
      const typeLit = line.match(/type:\s*z\.literal\("([^"]+)"\)/);
      if (typeLit && !typeName) typeName = typeLit[1];
      const statusLit = line.match(/status:\s*z\.literal\("([^"]+)"\)/);
      if (statusLit && !statusName) statusName = statusLit[1];
      const field = line.match(/^\s{2}(\w+):\s/);
      if (field) fields.push(field[1]);
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
    }
    if (typeName || statusName) {
      schemas.push({
        schemaName: head[1],
        key: typeName ?? statusName,
        kind: typeName ? "type" : "status",
        fields,
      });
    }
  }
  return schemas;
}

function readGoSource() {
  const parts = [];
  for (const dir of [GO_SERVER_DIR, GO_PI_DIR]) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".go") || file.endsWith("_test.go")) continue;
      parts.push(fs.readFileSync(path.join(dir, file), "utf8"));
    }
  }
  return parts.join("\n");
}

/** Go switch 里 `case "a", "b":` 收集的入站消息名。 */
export function goHandledMessageTypes(goSource) {
  const handled = new Set();
  for (const m of goSource.matchAll(/case\s+((?:"[^"]+"\s*,?\s*)+):/g)) {
    for (const s of m[1].matchAll(/"([^"]+)"/g)) handled.add(s[1]);
  }
  return handled;
}

/** Go 里出现过的 json tag 与字面 key。 */
function goKnownKeys(goSource) {
  const keys = new Set();
  for (const m of goSource.matchAll(/json:"([^",]+)(?:,[^"]*)?"/g)) keys.add(m[1]);
  for (const m of goSource.matchAll(/"([a-zA-Z][a-zA-Z0-9_.]*)":/g)) keys.add(m[1]);
  return keys;
}

const IGNORED_FIELDS = new Set(["type", "requestId", "status"]);

/**
 * 找出 `case "<msg>":` 到下一个 `case ` 之间的源码切片。
 *
 * 这一步是必需的：早先的实现只检查「字段名在整份 Go 源码里出现过」。`parentPath` 恰好
 * 出现在 `internal/workspace/files.go` 的一个函数签名里，于是
 * `project.create_directory.request` 被判为已覆盖——而真正处理它的 handler 读的是
 * `parentDirectory`。真实后果是「新建项目目录」永远建在 daemon 的 cwd 下。
 */
export function handlerScopeFor(goSource, messageType) {
  const needle = `"${messageType}"`;
  const blocks = [];
  let idx = goSource.indexOf(needle);
  while (idx !== -1) {
    const lineStart = goSource.lastIndexOf("\n", idx) + 1;
    const lineEnd = goSource.indexOf("\n", idx);
    const line = goSource.slice(lineStart, lineEnd === -1 ? goSource.length : lineEnd);
    // 一个消息可能出现在两处：`case "a", "<type>":` 的开头行，或多行 case 列表里的续行
    // `"<type>":`。早先只认第一种，于是多行列表里的消息拿不到作用域——`project.github.clone`
    // 因此被判缺失字段，而它的 struct 就在旁边。
    const isCaseHead = /^\s*case\s/.test(line);
    const isCaseContinuation = /^\s*"[a-zA-Z][a-zA-Z0-9_.]*"(:|,\s*$)/.test(line);
    if (isCaseHead || isCaseContinuation) {
      // 作用域是这个 **case 组**，不是单行：续行没有自己的分支，它和组内其它消息共用同一个
      // body。所以从组首的 `case ` 行开始切。
      const fnStart = goSource.lastIndexOf("\nfunc ", idx);
      const groupStart = isCaseHead
        ? lineStart
        : Math.max(fnStart, goSource.lastIndexOf("\n\tcase ", idx)) + 1 || lineStart;

      // 组尾止于本函数内：早先一路找到下一个 `\n\tcase `，跨过函数边界后把别的 handler 的
      // struct 也算了进来，于是字段对账的结果取决于函数顺序。
      //
      // 这里必须按 `\n+func ` 找边界：函数之间通常隔一个空行，只找 `\nfunc ` 会漏掉边界，
      // 于是作用域一路跨到下下个函数。
      const nextFuncMatch = /\n+func /.exec(goSource.slice(idx));
      const nextFunc = nextFuncMatch === null ? -1 : idx + nextFuncMatch.index;
      const nextCase = goSource.indexOf("\n\tcase ", lineEnd);
      const limit = nextFunc === -1 ? goSource.length : nextFunc;
      const scopeEnd = nextCase === -1 || nextCase > limit ? limit : nextCase;
      blocks.push(goSource.slice(groupStart, scopeEnd));
    }
    idx = goSource.indexOf(needle, idx + needle.length);
  }

  // `case "x": s.handleFoo(ctx, sink, raw)` 把真正的解析放在被调函数里，
  // 所以要把这些 `handle*` 的函数体一并纳入作用域。
  const dispatch = blocks.join("\n");
  for (const call of dispatch.matchAll(/\bs\.(handle[A-Z]\w*)\(/g)) {
    const fnName = call[1];
    const fnStart = goSource.indexOf(`func (s *Server) ${fnName}(`);
    if (fnStart === -1) continue;
    const fnEnd = goSource.indexOf("\nfunc ", fnStart + 1);
    blocks.push(goSource.slice(fnStart, fnEnd === -1 ? goSource.length : fnEnd));
  }
  return blocks.join("\n");
}

export function auditInbound(schemas, goSource, inboundMembers) {
  const handled = goHandledMessageTypes(goSource);
  const rows = [];
  for (const s of schemas) {
    if (s.kind !== "type") continue;
    if (!inboundMembers.has(s.schemaName)) continue;
    if (!handled.has(s.key)) continue; // 未路由的消息单独由路由覆盖率负责
    if (INTENTIONALLY_UNSUPPORTED.has(s.key)) continue;

    const scope = handlerScopeFor(goSource, s.key);
    const scopeKeys = goKnownKeys(scope);
    const missing = s.fields.filter((f) => !IGNORED_FIELDS.has(f) && !scopeKeys.has(f));
    if (missing.length) rows.push({ key: s.key, schemaName: s.schemaName, missing });
  }
  return rows.sort((a, b) => b.missing.length - a.missing.length);
}

export function auditRouting(schemas, goSource, inboundMembers) {
  const handled = goHandledMessageTypes(goSource);
  const missing = [];
  for (const s of schemas) {
    if (s.kind !== "type") continue;
    if (!inboundMembers.has(s.schemaName)) continue;
    if (INTENTIONALLY_UNSUPPORTED.has(s.key)) continue;
    if (!handled.has(s.key)) missing.push(s.key);
  }
  return missing.sort();
}

/**
 * 第二层：字段接住了但没被用。
 *
 * 第一层只要求字段名在 Go 里出现过——一个 `Foo string `json:"foo"`` 就能骗过它，
 * 然后这个值被解析进 struct 就地丢弃。这里按 json tag 反查 Go 标识符，要求它在
 * 声明之外还被引用过（赋值 / 传给下游 / 出现在响应里）。
 */
/** 所有入站 request schema 的字段并集。 */
export function inboundFieldUniverse(inboundMembers, schemas) {
  const fields = new Set();
  for (const s of schemas) {
    if (!inboundMembers.has(s.schemaName)) continue;
    for (const f of s.fields) fields.add(f);
  }
  return fields;
}

export function auditParsedButIgnored(goSource, fieldUniverse) {
  const byTag = new Map();
  for (const m of goSource.matchAll(/(\w+)\s+[\w[\]*. }]+?\s*`json:"([^",]+)(?:,[^"]*)?"`/g)) {
    const [, ident, tag] = m;
    if (!byTag.has(tag)) byTag.set(tag, new Set());
    byTag.get(tag).add(ident);
  }
  const rows = [];
  for (const [tag, idents] of byTag) {
    // 只查入站请求字段；pi.Model / CatalogModel 这类纯数据载体是直接序列化回去的，
    // 永远不会有 `.Field` 取值，查了也是噪音。
    if (fieldUniverse && !fieldUniverse.has(tag)) continue;
    for (const ident of idents) {
      const uses = (goSource.match(new RegExp(`\\.${ident}\\b`, "g")) ?? []).length;
      if (uses === 0) {
        rows.push({ field: tag, ident });
        break;
      }
    }
  }
  return rows.sort((a, b) => a.field.localeCompare(b.field));
}

export function auditOutbound(schemas, goSource) {
  const known = goKnownKeys(goSource);
  const inbound = goHandledMessageTypes(goSource);
  const rows = [];
  for (const s of schemas) {
    if (inbound.has(s.key)) continue; // 入站请求归 inbound 管
    // 只有 Go 确实发过这个名字，才要求它把字段填全。
    if (!goSource.includes(`"${s.key}"`)) continue;
    const missing = s.fields.filter((f) => !IGNORED_FIELDS.has(f) && !known.has(f));
    if (missing.length) rows.push({ key: s.key, kind: s.kind, schemaName: s.schemaName, missing });
  }
  return rows.sort((a, b) => b.missing.length - a.missing.length);
}

export function runAudit(root = ROOT) {
  const protocolSource = fs.readFileSync(
    path.join(root, "packages/protocol/src/messages.ts"),
    "utf8",
  );
  const schemas = parseProtocolSchemas(protocolSource);
  const inboundMembers = parseInboundUnionMembers(protocolSource);
  const goSource = readGoSource();
  return {
    schemas: schemas.length,
    inboundSchemas: inboundMembers.size,
    inbound: auditInbound(schemas, goSource, inboundMembers),
    outbound: auditOutbound(schemas, goSource),
    unrouted: auditRouting(schemas, goSource, inboundMembers),
    ignored: auditParsedButIgnored(goSource, inboundFieldUniverse(inboundMembers, schemas)),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const report = runAudit();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`协议 schema 总数: ${report.schemas}  入站 schema: ${report.inboundSchemas}`);
    console.log(`\n== 入站字段缺口 (${report.inbound.length} 条消息) ==`);
    for (const r of report.inbound)
      console.log(`  ${r.key} (${r.missing.length}) -> ${r.missing.join(", ")}`);
    console.log(`\n== 出站字段缺口 (${report.outbound.length} 条消息) ==`);
    for (const r of report.outbound)
      console.log(`  [${r.kind}] ${r.key} (${r.missing.length}) -> ${r.missing.join(", ")}`);
    console.log(`\n== 未路由入站消息 (${report.unrouted.length}) ==`);
    for (const k of report.unrouted) console.log(`  ${k}`);
    console.log(`\n== 解析了但从未使用 (${report.ignored.length}) — advisory，不阻断 ==`);
    for (const r of report.ignored) console.log(`  ${r.field} (${r.ident})`);
  }
  const failed =
    report.inbound.length +
      report.outbound.length +
      report.unrouted.length +
      report.ignored.length >
    0;
  process.exit(failed ? 1 : 0);
}
