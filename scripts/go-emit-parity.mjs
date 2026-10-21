#!/usr/bin/env node
/* eslint-disable complexity, max-depth -- 这是一个源码解析器：lexer 的分支深度与圈复杂度
   直接对应 Go/TypeScript 语法的嵌套层级。拆成更多小函数只会把状态在函数间传来传去，
   反而更难核对。读者要对照的是语法，不是控制流。 */
/**
 * 出站消息字段对账：协议声明了哪些字段，Go 实际发了哪些。
 *
 * 为什么需要它：`packages/protocol` 的功能字段几乎全是 `.optional()`。Go 漏发一个不会让
 * `WSOutboundMessageSchema` 报错，只会在界面上静默退化——上下文用量环不显示、工作区状态不
 * 更新、导入列表不显示「已导入 N 条」。这些都是用户先看到的，不是测试先看到的。
 *
 * ## 它能抓什么
 *
 * 已在真实回归上验证：把 `payload["lastUsage"] = rec.Usage` 删掉，这个脚本会报出来。
 * `lastUsage` 埋在 `agent` 里，顶层字段全对，只有递归下钻才看得见。
 *
 * ## 已知局限（不要把它当 100% 精确）
 *
 * - **假阳性**：Go 用 `respPayload := map[string]any{...}` 再传给发送函数时，payload 是变量，
 *   静态拿不到字段；同一类型有多个发送分支（正常 / notModified / error）时按并集判断，
 *   仍可能报出实际存在的字段。
 * - **假阴性**：字段值来自循环里构造的切片（`entries[]`）、或经接口/泛型传递时，检测不到。
 * - **假阴性**：同一 switch 分支内用 `respType := "a"; if x { respType = "b" }` 派生响应名时，
 *   目前只识别第一个，"b" 会被误报成 NEVER_SENT。遇到时人工核对再改脚本。
 *
 * 因此输出里每条都值得人工确认，但**不能因为怀疑假阳性就不看**。
 *
 * ## 用法
 *
 *   node scripts/go-emit-parity.mjs          人读报告
 *   node scripts/go-emit-parity.mjs --json   机器读
 *
 * 退出码：存在 MISSING 时为 1（默认接入 CI 前先人工确认噪音水平）。
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/**
 * 该字段由尚未实现的子系统承载，Go 侧没有语义可填。
 *
 * 明确列出来，而不是用 `_ = x` 假装成功：Plugin 运行时与 Hub 远控都还没做，
 * `toolPolicyApplied` 只有在真的把 tool policy 应用到远端 agent 时才有意义。
 * 每次新增豁免都必须在这里写理由，否则「豁免清单」会变成掩盖缺口的垃圾桶。
 */
const DEFERRED_FIELDS = new Map([
  [
    "hub.execution.agent.create.response",
    new Set(["toolPolicyApplied"]), // Hub 远控未实现，没有策略可应用
  ],
]);

/**
 * 合法的「按条件省略」字段。
 *
 * 这些是 optional 且**非 nullable**，发 null 会让整条响应失效，所以代码里只在有值时添加。
 * 静态检查看不到这个条件，会当成「从不发送」。列在这里意味着：**已确认是条件省略，
 * 不是漏发**。新增条目必须写清楚条件。
 */
const CONDITIONALLY_OMITTED = new Map([
  ["workspace.create.response", new Set(["errorCode", "setupSkippedReason"])], // 仅失败/skip 时
  ["create_byspace_worktree_response", new Set(["errorCode", "setupSkippedReason"])],
  ["tunnel.create.response", new Set(["error"])], // 仅失败时
  ["tunnel.remove.response", new Set(["error"])],
  ["hub.management.daemon.disconnect.response", new Set(["warning"])],
  ["providers_snapshot_update", new Set(["cwd"])], // 仅请求带 cwd 时
]);

/** 这些出站消息由客户端或中继产生，daemon 不发。 */
const CLIENT_ONLY = new Set(["pong", "terminal_output"]);

/**
 * 属于尚未实现的子系统，Go 侧没有语义可发。每条都要写明缺口归属。
 *
 * 不放进 `_ = x` 之类的假实现：它们是功能缺失，不是字段漏发。
 */
const DEFERRED_TYPES = new Map([
  ...[
    "hub.execution.agent.update",
    "hub.execution.agent.stream",
    "hub.management.daemon.connect.response",
    "hub.management.daemon.get_status.response",
    "hub.management.daemon.disconnect.response",
    "hub.management.daemon.permissions.update.response",
  ].map((t) => [t, "Hub 远程托管未实现（agent 只在本地跑）"]),
  ...[
    "plugin.directory.install.response",
    "plugin.source.install.response",
    "plugin.remove.response",
  ].map((t) => [t, "plugin 运行时未实现（只读端返回空目录）"]),
  ...[
    "audio_output",
    "transcription_result",
    "voice_input_state",
    "dictation_stream_ack",
    "dictation_stream_finish_accepted",
    "dictation_stream_partial",
    "dictation_stream_final",
    "dictation_stream_error",
  ].map((t) => [t, "语音/听写是原生客户端能力，web 构建没有对应 UI"]),
  ["assistant_chunk", "流式文本走 agent_stream.timeline，该类型是旧协议残留"],
  ["artifact", "artifact 产出跟踪未实现"],
  ["agent_status", "状态变更统一走 agent_update"],
  ["agent_attention_required", "通知走 agent_update + web push，未单独发此消息"],
  ["terminal_attention_required", "终端注意提醒未实现"],
  ["activity_log", "唯一消费者是语音中止失败的 toast，语音功能本身未实现"],
  ["terminal_stream_exit", "PTY 退出走二进制帧 OpcodeExit，未额外发文本消息"],
  ["agent.timeline.replacement", "epoch 变化时客户端在重连时全量拉取，未单独广播（见 Issue）"],
  ["daemon.update.progress", "daemon 自更新未实现"],
]);

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "archive"].includes(entry.name)) continue;
      walk(full, ext, out);
    } else if (entry.name.endsWith(ext) && !entry.name.includes("_test.")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 解析 `Name = z.object({ type: z.literal("x"), payload: z.object({ ... }) })`。
 *
 * 出站消息统一是 `{ type, payload }` 两层：字段在 `payload` 里面，所以解析要下钻一层，
 * 否则每个消息都只会看到一个叫 `payload` 的字段。
 */
export function parseSchemas(source) {
  const lines = source.split("\n");
  const schemas = new Map();
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^(?:export )?const (\w+) = z\.object\(\{$/);
    if (!head) continue;

    let depth = 1; // 已进入最外层对象
    let typeName = null;
    let payloadDepth = -1; // payload 对象内部的层级
    const fields = [];
    let optional = null;
    let nullable = null;
    const refs = new Map();

    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const line = lines[j];

      const lit = line.match(/^\s+type:\s*z\.literal\("([^"]+)"\)/);
      if (lit && !typeName) typeName = lit[1];

      // 进入 payload 层（多行对象）
      if (payloadDepth === -1 && /^\s+payload:\s*z\.object\(\{$/.test(line)) {
        payloadDepth = depth + 1;
      }
      // 单行 payload：`payload: z.object({ requestId: z.string() })`
      if (payloadDepth === -1) {
        const inline = line.match(/^\s+payload:\s*z\.object\(\{(.*)\}\)/);
        if (inline) {
          for (const fm of inline[1].matchAll(/(\w+):\s/g)) fields.push(fm[1]);
          continue;
        }
      }

      // 收字段：payload 结构只看 payload 第一层；没有 payload 的纯对象 schema
      // （AgentDirectoryResponseEntrySchema 这类嵌套载体）看最外层第一层。
      const target = payloadDepth > 0 ? payloadDepth : 1;
      if (depth === target) {
        const field = line.match(/^\s+(\w+):\s/);
        if (field) {
          fields.push(field[1]);
          // `.nullable().optional()` and `.optional().nullable()` both occur; scan the whole
          // line rather than assuming an order.
          if (/\.optional\(\)/.test(line)) (optional ??= new Set()).add(field[1]);
          if (/\.nullable\(\)/.test(line)) (nullable ??= new Set()).add(field[1]);
          const ref =
            line.match(/^\s+\w+:\s*(\w+Schema)\.?(?:nullable\(\))?\.?(?:optional\(\))?,?$/) ||
            line.match(/^\s+\w+:\s*z\.array\((\w+Schema)\)/);
          if (ref) refs.set(field[1], ref[1]);
        }
      }

      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
    }

    {
      // payload 不是平铺对象（union / passthrough / 引用）时只会看到 `payload` 这个 key，
      // 标为 opaque：无法静态比对，交给人工，不制造假阳性。
      const opaque = fields.includes("payload");
      const flat = fields.filter((f) => f !== "type" && f !== "payload");
      schemas.set(head[1], {
        key: typeName,
        fields: opaque ? [] : flat,
        refs,
        opaque,
        optional: optional ?? new Set(),
        nullable: nullable ?? new Set(),
      });
    }
  }
  return schemas;
}

/** 协议里出站联合体的成员名。 */
export function outboundMembers(source) {
  const start = source.indexOf("export const SessionOutboundMessageSchema");
  if (start < 0) return new Set();
  const block = source.slice(start, source.indexOf("]);", start));
  const members = new Set();
  for (const m of block.matchAll(/^\s+([A-Z]\w+Schema),$/gm)) members.add(m[1]);
  return members;
}

function splitGoArgs(text) {
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * Go 侧的发送点。
 *
 * 两种签名：`sendSessionMsg(ctx, sink, "type", payload)` 与
 * `broadcastSessionMsg("type", payload)`。payload 是 `map[string]any{...}` 字面量时可静态
 * 取字段，否则记为变量型。
 */
/** 全仓函数名 → 函数体，跨文件跟 builder 用。 */
export function goFunctionIndex(root = ROOT) {
  const index = new Map();
  for (const file of walk(path.join(root, "internal"), ".go")) {
    const text = fs.readFileSync(file, "utf8");
    const re = /^func (?:\(\w+ \*?\w+\) )?(\w+)\(/gm;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const next = text.indexOf("\nfunc ", start + 1);
      index.set(m[1], text.slice(start, next === -1 ? text.length : next));
    }
  }
  return index;
}

export function goEmitSites(root = ROOT, fnIndex = goFunctionIndex(root)) {
  const literals = new Map();
  const dynamic = new Set();
  // 每个发送点各自的 key 集合：嵌套对象要在**同一个 payload**里找，
  // 用全局集合会让任何字段都「出现过」，检查形同虚设。
  const perSite = [];
  for (const file of walk(path.join(root, "internal"), ".go")) {
    const text = fs.readFileSync(file, "utf8");
    const re = /\b(sendSessionMsg|broadcastSessionMsg)\(/g;
    let m;
    while ((m = re.exec(text))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < text.length && depth > 0) {
        const ch = text[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      const args = splitGoArgs(text.slice(start, i - 1));
      const typeArg = args.find(
        (a) =>
          /^"[a-z0-9_.]+"$/.test(a.replace(/\s+/g, "")) ||
          /^respType$|^msgType$|^respName$/.test(a.trim()),
      );
      if (!typeArg) continue;
      // 字面量参数才剥引号；`respType` 这类标识符剥了会变成 `espTy`。
      const isLiteralArg = typeArg.trim().startsWith('"');
      let type = isLiteralArg ? typeArg.replace(/\s+/g, "").slice(1, -1) : typeArg.trim();
      if (!isLiteralArg) {
        // `strings.TrimSuffix(msgType, ".request") + ".response"`：从所在分支里收集
        // 所有 `case "a.request", "b.request":` 的字面量，逐个映射成 .response。
        {
          // 无法从 `respType` 的赋值推断时（`strings.TrimSuffix(msgType, ...)`），
          // 退回到所在 case 分支里的 .request 字面量。
          const before = text.slice(Math.max(0, m.index - 2000), m.index);
          const caseIdx = before.lastIndexOf("\n\tcase ");
          if (caseIdx >= 0) {
            const branch = before.slice(caseIdx);
            const reqs = [...branch.matchAll(/"([a-z0-9_.]+)\.request"/g)].map(
              (x) => x[1] + ".response",
            );
            if (reqs.length) {
              const payloadArg = args[args.indexOf(typeArg) + 1] ?? "";
              const keys = payloadArg.startsWith("map[string]any{")
                ? keysOfInlineMap(payloadArg, fnIndex)
                : collectKeysFromNearby(text, m.index, fnIndex);
              for (const candidate of reqs) {
                if (!keys) {
                  dynamic.add(candidate);
                  continue;
                }
                if (!literals.has(candidate)) literals.set(candidate, new Set());
                for (const k of keys.allKeys) literals.get(candidate).add(k);
                perSite.push({
                  type: candidate,
                  keys: keys.keys,
                  allKeys: keys.allKeys,
                  payloadText: keys.text,
                });
              }
              continue;
            }
          }
        }

        // `respType := "x"` 这种间接寻址：在同一函数里往上找最近的赋值。
        const head = text.slice(0, m.index);
        const assign = new RegExp(`${typeArg.trim()}\\s*:?=\\s*"([a-z0-9_.]+)"`, "g");
        const candidates = [];
        let a;
        while ((a = assign.exec(head))) candidates.push(a[1]);
        if (candidates.length === 0) continue;
        // 一个变量可能有多个分支赋值（fetch_agents / fetch_agent_history），
        // 取第一个作为主类型，其余记入 aliases，供后续按类型查表时也能命中。
        type = candidates[candidates.length - 1];
        const aliases = candidates.slice(0, -1);
        const keys = collectKeysFromNearby(text, m.index, fnIndex);
        if (keys) {
          for (const candidate of candidates) {
            if (!literals.has(candidate)) literals.set(candidate, new Set());
            for (const k of keys.allKeys) literals.get(candidate).add(k);
            perSite.push({
              type: candidate,
              keys: keys.keys,
              allKeys: keys.allKeys,
              payloadText: keys.text,
            });
          }
        } else {
          for (const candidate of candidates) dynamic.add(candidate);
        }
        void aliases;
        continue;
      }
      const payload = args[args.indexOf(typeArg) + 1] ?? "";
      if (payload.startsWith("map[string]any{")) {
        const cleaned = payload.replace(/\/\/[^\n]*/g, (mm) => " ".repeat(mm.length));
        const keys = topLevelKeys(cleaned, cleaned.indexOf("{"));
        if (keys.length) {
          if (!literals.has(type)) literals.set(type, new Set());
          for (const k of keys) literals.get(type).add(k);
          // 该发送点的可见 key：payload 文本本身，加上 payload 里调用的 builder 函数体。
          // `agent: s.buildAgentSnapshotPayload(rec)` 的字段在 builder 里，不追进去就查不到。
          const visible = new Set(
            [...payload.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":/g)].map((x) => x[1]),
          );
          // 顺着 payload 里调用的任何 Go 函数往下走（方法或包级函数），收集它们 map 字面量
          // 里的 key。`agent: s.buildAgentSnapshotPayload(rec)` 的字段全在 builder 里。
          const seen = new Set();
          const queue = [...payload.matchAll(/(?:\bs\.|\b)([A-Za-z_]\w*)\(/g)].map((x) => x[1]);
          while (queue.length) {
            const fn = queue.shift();
            if (seen.has(fn)) continue;
            seen.add(fn);
            const body = fnIndex.get(fn);
            if (!body) continue;
            for (const km of body.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s/g)) visible.add(km[1]);
            for (const nested of body.matchAll(/(?:\bs\.|\b)([A-Za-z_]\w*)\(/g))
              queue.push(nested[1]);
          }
          perSite.push({ type, keys: new Set(keys), allKeys: visible, payloadText: payload });
        } else {
          dynamic.add(type);
        }
      } else {
        // payload 是变量时，回溯它的字面量初始化 + 后续的下标赋值。
        const varName = payload.trim();
        if (/^[A-Za-z_]\w*$/.test(varName)) {
          const head = text.slice(0, m.index);
          const initRe = new RegExp(`${varName}\\s*:?=\\s*map\\[string\\]any\\{`, "g");
          let init = null;
          let mm;
          while ((mm = initRe.exec(head))) init = mm;
          const keys = new Set();
          if (init) {
            const bodyStart = init.index + init[0].length - 1;
            let d = 0;
            let end = bodyStart;
            for (let k = bodyStart; k < text.length; k++) {
              if (text[k] === "{") d++;
              else if (text[k] === "}") {
                d--;
                if (d === 0) {
                  end = k + 1;
                  break;
                }
              }
            }
            const body = text.slice(bodyStart, end);
            const cleaned = body.replace(/\/\/[^\n]*/g, (x) => " ".repeat(x.length));
            for (const k of topLevelKeys(cleaned, 0)) keys.add(k);
          }
          const assignRe = new RegExp(`${varName}\\["([A-Za-z][A-Za-z0-9_]*)"\\]\\s*=`, "g");
          let am;
          while ((am = assignRe.exec(text.slice(0, m.index + 2000)))) keys.add(am[1]);
          if (keys.size) {
            if (!literals.has(type)) literals.set(type, new Set());
            for (const k of keys) literals.get(type).add(k);
            // builder 调用（`providers.BuildCompactSnapshot(entries)`）的字段在函数体里。
            const visible = new Set(keys);
            const seen = new Set();
            const queue = [
              ...text.slice(m.index - 4000, m.index).matchAll(/\b(?:\w+\.)?([A-Za-z_]\w*)\(/g),
            ].map((x) => x[1]);
            while (queue.length) {
              const fn = queue.shift();
              if (seen.has(fn)) continue;
              seen.add(fn);
              const body = fnIndex.get(fn);
              if (!body) continue;
              for (const km of body.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s/g)) visible.add(km[1]);
              for (const nm of body.matchAll(/\b(?:\w+\.)?([A-Za-z_]\w*)\(/g)) queue.push(nm[1]);
            }
            perSite.push({ type, keys, allKeys: visible, payloadText: payload });
          } else {
            dynamic.add(type);
          }
          continue;
        }
        dynamic.add(type);
      }
    }
  }
  return { literals, dynamic, perSite };
}

const IDENT = /^\s*(?:"([A-Za-z_$][\w$]*)"|([A-Za-z_$][\w$]*))\s*([:,])/;

/** 从一段 `map[string]any{...}` 文本里收集 key（含 builder 函数体）。 */
export function keysOfInlineMap(payload, fnIndex) {
  const cleaned = payload.replace(/\/\/[^\n]*/g, (x) => " ".repeat(x.length));
  const keys = new Set(topLevelKeys(cleaned, cleaned.indexOf("{")));
  const visible = new Set(keys);
  const seen = new Set();
  const queue = [...payload.matchAll(/\b(?:\w+\.)?([A-Za-z_]\w*)\(/g)].map((x) => x[1]);
  while (queue.length) {
    const fn = queue.shift();
    if (seen.has(fn)) continue;
    seen.add(fn);
    const body = fnIndex.get(fn);
    if (!body) continue;
    for (const km of body.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s/g)) visible.add(km[1]);
    for (const nm of body.matchAll(/\b(?:\w+\.)?([A-Za-z_]\w*)\(/g)) queue.push(nm[1]);
  }
  return { keys, allKeys: visible, text: payload };
}

/** 从发送点之前的 4KB 里找 `map[string]any{...}` 字面量与下标赋值，收集 key。 */
export function collectKeysFromNearby(text, at, fnIndex) {
  const window = text.slice(Math.max(0, at - 4000), at);
  const init = window.match(/\b\w+\s*:?=\s*map\[string\]any\{/g);
  if (!init || init.length === 0) return null;
  const last = init[init.length - 1];
  const bodyStart = window.lastIndexOf(last) + last.length - 1;
  let d = 0;
  let end = bodyStart;
  for (let k = bodyStart; k < window.length; k++) {
    if (window[k] === "{") d++;
    else if (window[k] === "}") {
      d--;
      if (d === 0) {
        end = k + 1;
        break;
      }
    }
  }
  const cleaned = window.slice(bodyStart, end).replace(/\/\/[^\n]*/g, (x) => " ".repeat(x.length));
  const keys = new Set(topLevelKeys(cleaned, 0));
  // 之后的 `payload["x"] = ...` 也是 payload 的一部分（可选字段常这么补）。
  const after = text.slice(at - 200, at + 200);
  const varName = /\b(\w+)\s*=/.exec(window.slice(Math.max(0, bodyStart - 60), bodyStart))?.[1];
  for (const m of text
    .slice(Math.max(0, at - 4000), at + 2000)
    .matchAll(/\b(\w+)\["([A-Za-z][A-Za-z0-9_]*)"\]\s*=/g)) {
    if (varName && m[1] !== varName) continue;
    keys.add(m[2]);
  }
  void after;
  const visible = new Set(keys);
  const seen = new Set();
  const queue = [...window.slice(bodyStart, end).matchAll(/\b(?:\w+\.)?([A-Za-z_]\w*)\(/g)].map(
    (x) => x[1],
  );
  while (queue.length) {
    const fn = queue.shift();
    if (seen.has(fn)) continue;
    seen.add(fn);
    const body = fnIndex.get(fn);
    if (!body) continue;
    for (const km of body.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s/g)) visible.add(km[1]);
    for (const nm of body.matchAll(/\b(?:\w+\.)?([A-Za-z_]\w*)\(/g)) queue.push(nm[1]);
  }
  return { keys, allKeys: visible, text: window.slice(bodyStart, end) };
}

/** 从 `{` 开始收集顶层 key，支持 `k: v`、`k,`、`"k": v`，跳过 `...spread`。 */
export function topLevelKeys(text, start) {
  // 注释里的文字会让 `prev char` 判定失败，先把行注释抹成空格（保留换行，位置不变）。
  const keys = [];
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
      i += 1;
      continue;
    }
    if (depth === 1) {
      if (text.startsWith("...", i)) {
        let d = 0;
        i += 3;
        while (i < text.length) {
          const c = text[i];
          if ("([{".includes(c)) d += 1;
          else if (")]}".includes(c)) {
            if (d === 0) break;
            d -= 1;
          } else if (c === "," && d === 0) break;
          i += 1;
        }
        continue;
      }
      let prev = i - 1;
      while (prev >= 0 && " \t\n\r".includes(text[prev])) prev -= 1;
      if (prev >= 0 && "{,".includes(text[prev])) {
        const m = IDENT.exec(text.slice(i));
        if (m) {
          keys.push(m[1] ?? m[2]);
          i += m[0].length - 1;
        }
      }
    }
    i += 1;
  }
  return keys;
}

/** Go 结构体里出现过的 json tag，用于判断变量型 payload 是否可能带上某字段。 */
export function goStructTags(root = ROOT) {
  const tags = new Set();
  for (const file of walk(path.join(root, "internal"), ".go")) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/json:"([^",]+)(?:,[^"]*)?"/g)) tags.add(m[1]);
    // map 字面量里的 key 也是「Go 可能发出的字段」——嵌套对象大多这么构造。
    for (const m of text.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s/g)) tags.add(m[1]);
  }
  return tags;
}

/**
 * 递归下钻：对 payload 里出现的每个嵌套对象字段（如 `agent`、`workspace`），
 * 取出它自己的 schema 字段，再和 Go 在该层级实际发出的 key 比对。
 *
 * 这是抓 `agent.lastUsage` 这种问题的唯一办法：它在**嵌套**一层里，顶层字段全都对得上。
 * 做法是收集 Go 源码里所有 map 字面量的 key 集合（不分层级），对嵌套 schema 做包含判断——
 * 宁可多报也不能漏，漏掉的代价是界面上少一块数据而没人知道。
 */
export function nestedObjectFields(schemas, schema, depth = 0) {
  const nested = new Map();
  if (depth > 3) return nested;
  for (const field of schema.fields) {
    const ref = schema.refs?.get(field);
    if (!ref || !schemas.has(ref)) continue;
    const inner = schemas.get(ref);
    nested.set(field, inner.fields);
    // 继续往下走一层：`entries[] → agent` 这种两级嵌套很常见。
    for (const [deepField, deepFields] of nestedObjectFields(schemas, inner, depth + 1)) {
      nested.set(`${field}[].${deepField}`, deepFields);
    }
  }
  return nested;
}

// 空响应也能合法成立的字段：请求回执与错误槽位。
const ALWAYS_PRESENT = new Set(["requestId", "type"]);

/** 该字段在 payload 里已经有值（对象的 key 集合包含它），无论值是不是平铺字段。 */
function fieldPresent(site, field) {
  if (site.keys.has(field)) return true;
  return new RegExp(`"${field}":\\s*(?:map\\[string\\]any\\{|[A-Za-z_])`).test(
    site.payloadText ?? "",
  );
}

export function runAudit({ schemas, members, emits, structTags }) {
  const { literals, dynamic } = emits;
  void structTags;
  const missing = [];
  const unverified = [];
  const neverSent = [];
  const optionalGaps = [];
  // 发 null 给 optional-but-not-nullable 字段会让**整条响应**校验失败，比不发更糟：
  // 前端拿不到任何数据。这类错误此前靠人工发现（projectIconRevision、runtimeInfo 各一次）。
  const nulledOptional = [];

  // 只对 daemon 负责的出站消息做检查：它们必须出现在 Go 的发送点里。
  // 没有传入成员集合时（测试、或协议文件里没找到联合体），退化为「所有带 type 字面量的
  // schema」，否则一次解析失败就会让整个审计静默通过。
  const schemaIter =
    members.size > 0
      ? [...members].map((name) => schemas.get(name)).filter(Boolean)
      : [...schemas.values()].filter((schema) => schema.key);
  for (const schema of schemaIter) {
    const type = schema.key;
    if (CLIENT_ONLY.has(type)) continue;

    // payload 是 discriminatedUnion / passthrough 时字段没法静态比，
    // 但**发没发**是一个独立且能确定的问题。跳过字段检查不等于跳过存在性检查。
    const lit = literals.get(type);
    if (schema.opaque) {
      const sentHere = emits.perSite.some((x) => x.type === type);
      if (!lit && !sentHere && !dynamic.has(type) && !DEFERRED_TYPES.has(type)) {
        neverSent.push({ type, fields: [] });
      }
      continue;
    }
    if (lit) {
      const deferred = DEFERRED_FIELDS.get(type) ?? new Set();
      const sites = emits.perSite.filter((x) => x.type === type);
      const omitted = CONDITIONALLY_OMITTED.get(type) ?? new Set();
      const gap = schema.fields.filter(
        (f) =>
          !ALWAYS_PRESENT.has(f) &&
          !deferred.has(f) &&
          !omitted.has(f) &&
          !sites.some((x) => fieldPresent(x, f)),
      );
      for (const site of sites) {
        for (const field of schema.fields) {
          if (!schema.optional.has(field) || (schema.nullable ?? new Set()).has(field)) continue;
          const nulled = new RegExp(`"${field}":\\s*nil\\b`).test(site.payloadText ?? "");
          const nulledAssign = new RegExp(`\\["${field}"\\]\\s*=\\s*nil\\b`).test(
            site.payloadText ?? "",
          );
          if (nulled || nulledAssign) {
            nulledOptional.push({ type, field });
          }
        }
      }

      const required = gap.filter((f) => !schema.optional.has(f));
      const optionalGap = gap.filter((f) => schema.optional.has(f));
      if (required.length) missing.push({ type, fields: required });
      if (optionalGap.length) optionalGaps.push({ type, fields: optionalGap });
      // 嵌套：payload 里的对象字段（agent/workspace/…）各自还有一层字段。
      for (const [field, innerFields] of nestedObjectFields(schemas, schema)) {
        const sitesWithField = sites.filter((x) => x.keys.has(field));
        if (sitesWithField.length === 0) continue;
        {
          const site = sitesWithField[0];
          const innerGap = innerFields.filter(
            (f) => !ALWAYS_PRESENT.has(f) && !site.allKeys.has(f),
          );
          if (innerGap.length) {
            // 该字段的值如果是变量（`"agent": agentPayload`），字段内容不在本函数里，
            // 静态无法判定是否齐全 —— 归为 UNVERIFIED，不制造假阳性。
            // 数组型嵌套（`"entries": rows`、`append(list, ...)`）必然由循环构造，
            // 元素字段不在本 payload 文本里，同样归为 UNVERIFIED。
            const isVariable = new RegExp(`"${field}":\\s*[a-z]`).test(site.payloadText ?? "");
            const isArray =
              sitesWithField.every((x) => !x.allKeys.has(innerFields[0])) ||
              (site.allKeys.has(field) && innerGap.length === innerFields.length);
            const entry = { type, fields: innerGap.map((f) => `${field}.${f}`) };
            (isVariable || isArray ? unverified : missing).push(entry);
          }
        }
      }
      continue;
    }
    if (dynamic.has(type)) {
      const gap = schema.fields.filter((f) => !ALWAYS_PRESENT.has(f) && !structTags.has(f));
      if (gap.length) unverified.push({ type, fields: gap });
      continue;
    }
    if (DEFERRED_TYPES.has(type)) continue;
    neverSent.push({ type, fields: schema.fields.filter((f) => !ALWAYS_PRESENT.has(f)) });
  }
  return { missing, unverified, neverSent, optionalGaps, nulledOptional };
}

/** Convenience entry used by tests: parse the protocol file and scan one Go source string. */
export function auditFromSources({ protocolSource, goSource }) {
  const schemas = parseSchemas(protocolSource);
  // The emit scanner walks files; for a snippet, stand in with an index-free scan of the text.
  const emits = goEmitSitesFromText(goSource);
  // No repository-wide struct tags: a snippet must be judged on its own text, otherwise every
  // field looks "present" because some other file mentions it.
  return runAudit({
    schemas,
    members: new Set(),
    emits,
    structTags: new Set(),
  });
}

/** Like goEmitSites but over a single in-memory source string. */
export function goEmitSitesFromText(text) {
  const literals = new Map();
  const dynamic = new Set();
  const perSite = [];
  const re = /(sendSessionMsg|broadcastSessionMsg)\(([^;]*?)"([a-z0-9_.]+)"\s*,\s*([^;]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[3];
    const rest = m[4] ?? "";
    if (!rest.trimStart().startsWith("map[string]any{")) {
      dynamic.add(type);
      continue;
    }
    const start = m.index + m[0].length - rest.length + (rest.length - rest.trimStart().length);
    const keys = new Set(topLevelKeys(text, start + rest.trimStart().indexOf("{")));
    if (keys.size === 0) {
      dynamic.add(type);
      continue;
    }
    if (!literals.has(type)) literals.set(type, new Set());
    for (const key of keys) literals.get(type).add(key);
    // The whole `map[string]any{...}` literal, not just the slice up to the next semicolon:
    // the null check has to see every key in the payload.
    let depth = 0;
    let end = start;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    perSite.push({ type, keys, allKeys: keys, payloadText: text.slice(start, end) });
  }
  return { literals, dynamic, perSite };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const protocolPath = path.join(ROOT, "packages/protocol/src/messages.ts");
  const source = fs.readFileSync(protocolPath, "utf8");
  const schemas = parseSchemas(source);
  const members = outboundMembers(source);
  const emits = goEmitSites();
  const structTags = goStructTags();
  const report = runAudit({ schemas, members, emits, structTags });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `协议出站类型: ${members.size}   Go 字面量: ${emits.literals.size}   Go 变量型: ${emits.dynamic.size}`,
    );
    console.log(`\n== MISSING（协议有、Go 未发；确定缺口）${report.missing.length} ==`);
    for (const row of report.missing.sort((a, b) => b.fields.length - a.fields.length)) {
      console.log(`  ${row.type}: ${row.fields.join(", ")}`);
    }
    console.log(
      `\n== OPTIONAL_GAP（协议可选、Go 未发；界面特性可能静默缺失）${report.optionalGaps.length} ==`,
    );
    for (const row of report.optionalGaps.sort((a, b) => b.fields.length - a.fields.length)) {
      console.log(`  ${row.type}: ${row.fields.join(", ")}`);
    }
    console.log(
      `\n== NULLED_OPTIONAL（可选但不可 null 的字段被发成 null；会让整条响应失效）${report.nulledOptional.length} ==`,
    );
    for (const row of report.nulledOptional) {
      console.log(`  ${row.type}.${row.field}`);
    }
    console.log(`\n== NEVER_SENT（协议有、Go 从未发送）${report.neverSent.length} ==`);
    for (const row of report.neverSent) console.log(`  ${row.type}`);
    console.log(`\n== UNVERIFIED（payload 是变量，需人工核对）${report.unverified.length} ==`);
    for (const row of report.unverified.slice(0, 20)) {
      console.log(
        `  ${row.type}: ${row.fields.slice(0, 8).join(", ")}${row.fields.length > 8 ? " …" : ""}`,
      );
    }
  }
  process.exit(report.missing.length + report.neverSent.length > 0 ? 1 : 0);
}
