#!/usr/bin/env node
/**
 * 交付前自检：把三类检查串成一条命令。
 *
 * 为什么需要串起来：三个工具各查一层，漏掉任何一个都会让「界面上少一块数据」溜过去，
 * 而用户不该替我做这件事。
 *
 *   静态 · 入站  Go 有没有把客户端发来的字段接住     （硬失败）
 *   静态 · 出站  Go 有没有把协议要求的字段发全       （硬失败）
 *   动态 · 浏览器 真实 Chrome 里页面能不能用          （硬失败）
 *   动态 · 测试 Go 单测                                （硬失败）
 *
 * 浏览器检查需要 daemon 在跑；`--no-browser` 可跳过（例如没有 Chrome 的环境）。
 *
 * 用法：
 *   npm run audit                     全跑
 *   npm run audit -- --no-browser     跳过浏览器验证
 *   npm run audit -- --verbose        打印每一步的完整输出
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BASELINE = path.join(ROOT, "scripts", "audit-baseline.json");
const args = new Set(process.argv.slice(2));
const skipBrowser = args.has("--no-browser");
const verbose = args.has("--verbose");

/** 每一步：名字 + 命令 + 失败时的解释。 */
const STEPS = [
  {
    name: "Go 测试",
    run: ["go", ["test", "./..."]],
    why: "单测挂了说明代码本身有问题，先修这个，其余检查没有意义。",
  },
  {
    name: "入站字段对账",
    run: ["node", ["scripts/go-parity-audit.mjs"]],
    why: "客户端发来的字段 Go 没接住 —— 该功能在界面上点了没反应。",
    // 入站审计还有 47 条已知缺口（hub / plugin / 未实现的入站能力）。
    // 不阻断，但**数字不许涨**：涨了说明新写的 handler 又漏字段了。
    baseline: "inboundGaps",
  },
  {
    name: "出站字段对账",
    run: ["node", ["scripts/go-emit-parity.mjs"]],
    why: "协议要求的字段 Go 没发 —— 界面上那块数据永远空着或显示旧值。",
  },
  {
    name: "浏览器验证",
    run: ["node", ["scripts/browser-conformance.mjs"]],
    skip: skipBrowser,
    why: "真实 Chrome 里页面报错、菜单缺项、状态不对。需要 daemon 在跑。",
  },
];

function runStep(step) {
  const [cmd, cmdArgs] = step.run;
  try {
    const out = execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: verbose ? "inherit" : "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return { ok: true, out: out ?? "" };
  } catch (error) {
    return {
      ok: false,
      out: `${error.stdout ?? ""}${error.stderr ?? ""}`,
      status: error.status,
    };
  }
}

/** 从输出里抽一行摘要，避免整屏日志。 */
/** 失败时提示对应的单跑命令，避免把长输出塞进汇总。 */
function detailScript(step) {
  return (
    {
      入站字段对账: "audit:go-parity",
      出站字段对账: "audit:emit",
      浏览器验证: "audit:browser",
      "Go 测试": "test:go",
    }[step.name] ?? "audit"
  );
}

/** 成功 ✔ / 未阻断提醒 ! / 失败 ✘。 */
function markFor(result, guard) {
  if (result.ok) return "✔";
  return guard.ok ? "!" : "✘";
}

function summarize(step, out) {
  if (step.name === "入站字段对账") {
    const m = out.match(/入站字段缺口 \((\d+) 条消息\)/);
    const u = out.match(/未路由入站消息 \((\d+)\)/);
    if (m || u) return `字段缺口 ${m?.[1] ?? "?"} 条 · 未路由 ${u?.[1] ?? "?"} 条`;
  }
  if (step.name === "出站字段对账") {
    const miss = out.match(/MISSING（[^）]*）(\d+)/);
    const opt = out.match(/OPTIONAL_GAP（[^）]*）(\d+)/);
    const never = out.match(/NEVER_SENT（[^）]*）(\d+)/);
    if (miss)
      return `MISSING ${miss[1]} · OPTIONAL ${opt?.[1] ?? "?"} · NEVER_SENT ${never?.[1] ?? "?"}`;
  }
  if (step.name === "浏览器验证") {
    const m = out.match(/(\d+)\/(\d+) checks passed/);
    if (m) return `${m[1]}/${m[2]} 通过`;
  }
  if (step.name === "Go 测试") {
    const failed = [...out.matchAll(/^--- FAIL: (\S+)/gm)].map((x) => x[1]);
    if (failed.length) return `失败 ${failed.length} 个: ${failed.slice(0, 3).join(", ")}`;
    return "全部通过";
  }
  return "";
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch {
    return {};
  }
}

/** 把「已知缺口」变成不许增长的上限，而不是可以一直挂着的提醒。 */
function checkBaseline(step, out, baseline) {
  const key = step.baseline;
  if (!key) return { ok: true };
  const limit = baseline[key];
  if (typeof limit !== "number") return { ok: true };
  const current = extractCount(step, out);
  if (current === null) return { ok: true };
  if (current > limit) {
    return {
      ok: false,
      reason: `${step.name} 从 ${limit} 涨到 ${current}：新增的 handler 又漏字段了。修掉，或更新 scripts/audit-baseline.json 并说明原因。`,
    };
  }
  if (current < limit) {
    return {
      ok: true,
      note: `已降到 ${current}（基线 ${limit}），可更新 scripts/audit-baseline.json`,
    };
  }
  return { ok: true };
}

function extractCount(step, out) {
  if (step.baseline === "inboundGaps") {
    const m = out.match(/入站字段缺口 \((\d+) 条消息\)/);
    return m ? Number(m[1]) : null;
  }
  return null;
}

const baseline = readBaseline();
const results = [];
for (const step of STEPS) {
  if (step.skip) {
    results.push({ step, skipped: true });
    continue;
  }
  process.stdout.write(`▸ ${step.name} … `);
  const started = Date.now();
  const result = runStep(step);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const summary = summarize(step, result.out);
  const guard = result.ok ? { ok: true } : checkBaseline(step, result.out, baseline);
  results.push({ step, result, summary, elapsed, guard });
  const mark = markFor(result, guard);
  process.stdout.write(`${mark} ${summary}  (${elapsed}s)\n`);
  if (guard.note) process.stdout.write(`    ${guard.note}\n`);
}

const failures = results.filter((r) => !r.skipped && !r.result.ok && !r.guard.ok);
const advisoryHits = results.filter((r) => !r.skipped && !r.result.ok && r.guard.ok);
const skipped = results.filter((r) => r.skipped);

if (failures.length > 0) {
  console.log("\n失败项：");
  for (const { step, summary, guard } of failures) {
    console.log(`\n  ✘ ${step.name} — ${summary}`);
    console.log(`     ${step.why}`);
    if (guard?.reason) console.log(`     ${guard.reason}`);
    // 只给「怎么查」，不倾倒几百行字段名——真正需要细节时用 --verbose 或单独跑该脚本。
    console.log(`     详情：npm run ${detailScript(step)}  （或 npm run audit -- --verbose）`);
  }
}

if (advisoryHits.length > 0) {
  console.log("\n提醒项（不阻断，但数字不该涨）：");
  for (const { step, summary } of advisoryHits) {
    console.log(`  ! ${step.name} — ${summary}`);
  }
}

if (skipped.length > 0) {
  console.log(`\n跳过：${skipped.map((s) => s.step.name).join("、")}`);
}

console.log(
  failures.length === 0
    ? `\n全部通过${advisoryHits.length ? `（${advisoryHits.length} 项提醒）` : ""}`
    : `\n${failures.length} 项失败`,
);

process.exit(failures.length > 0 ? 1 : 0);
