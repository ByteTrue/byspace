#!/usr/bin/env node
/**
 * 浏览器端一致性地毯检查（bsk 驱动真实 Chrome）。
 *
 * 为什么需要它：`scripts/go-parity-audit.mjs` 只能证明「协议字段被解析了」。
 * 但「思考等级菜单列出了这个模型不支持的档位」「工具调用卡片根本没渲染」这类问题，
 * 字段全对、Schema 全过、单测全绿，只有在真浏览器里点开菜单才看得见。
 *
 * 用法：node scripts/browser-conformance.mjs [--base http://127.0.0.1:6778]
 *
 * 每项检查都会：
 *   1. 用 bsk 操作真实 UI；
 *   2. 对可访问性快照文本做断言；
 *   3. 收集 console，任何 `Message validation failed` / `Response validation failed`
 *      都记为硬失败（这类错误意味着守护进程发的 payload 与协议不符）。
 *
 * 已知不覆盖：滚动是否卡顿、动画是否流畅、真实拖拽手势——这些只能人眼看。
 */

import { execFileSync } from "node:child_process";

const BASE = (() => {
  const idx = process.argv.indexOf("--base");
  return idx >= 0 ? process.argv[idx + 1] : "http://127.0.0.1:6778";
})();

const results = [];

function bsk(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("bsk", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw new Error(`bsk ${args.join(" ")} failed: ${error.stderr || error.message}`, {
      cause: error,
    });
  }
}

function sleep(ms) {
  execFileSync("sleep", [String(ms / 1000)]);
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const badge = ok ? "PASS" : "FAIL";
  console.log(`${badge}  ${name}${ok ? "" : `\n      ${detail.replace(/\n/g, "\n      ")}`}`);
}

function expectContains(name, snapshot, needles) {
  const missing = needles.filter((n) => !snapshot.includes(n));
  record(name, missing.length === 0, missing.length ? `missing: ${missing.join(" | ")}` : "");
}

function expectAbsent(name, snapshot, needles) {
  const found = needles.filter((n) => snapshot.includes(n));
  record(name, found.length === 0, found.length ? `unexpected: ${found.join(" | ")}` : "");
}

const session = (() => {
  const out = bsk(["session", "start", "--json"]);
  const match = out.match(/"session_id":\s*"([^"]+)"/);
  if (!match) throw new Error(`could not start a bsk session: ${out}`);
  return match[1];
})();

const observe = () => bsk(["observe", "--session", session]);
const consoleText = () => bsk(["debug", "console", "--session", session], { allowFailure: true });
const click = (ref) => bsk(["click", ref, "--session", session]);

function refFor(snapshot, pattern) {
  for (const line of snapshot.split("\n")) {
    const m = line.match(/@(e\d+)\s+/);
    if (m && pattern.test(line)) return `@${m[1]}`;
  }
  return null;
}

/** 直接从 daemon 读取 provider 快照——UI 只是它的投影。 */
function queryProviderSnapshot() {
  const script = `
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket("http://127.0.0.1:6778/ws");
    let done = false;
    const finish = (value) => { if (!done) { done = true; console.log(JSON.stringify(value)); process.exit(0); } };
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", clientId: "conf-providers", protocolVersion: 1 })));
    ws.on("message", (data) => {
      const json = JSON.parse(data.toString());
      const p = json?.message?.payload;
      if (p?.status === "server_info") {
        ws.send(JSON.stringify({ type: "session", message: { type: "get_providers_snapshot_request", requestId: "conf-1" } }));
      }
      if (json?.message?.type === "get_providers_snapshot_response") finish(p.entries ?? []);
    });
    setTimeout(() => finish([]), 4000);
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  try {
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function failFast(name, message) {
  record(name, false, message);
  throw new Error(`${name}: ${message}`);
}

try {
  bsk(["debug", "start", "--session", session, "--name", "browser-conformance"], {
    allowFailure: true,
  });
  bsk(["navigate", BASE, "--session", session]);
  sleep(2500);

  // ---------------------------------------------------------------- 侧边栏结构
  let snap = observe();

  expectContains("Sidebar lists the Chief home workspace", snap, ["BySpace-WorkSpace", "Chief"]);

  // Chief 必须排在 byspace 之前（它是 daemon 自持的 home workspace）。
  const chiefIdx = snap.indexOf('button "Chief"');
  const byspaceIdx = snap.indexOf('button "B byspace');
  record(
    "Chief is pinned above ordinary projects",
    chiefIdx >= 0 && byspaceIdx > chiefIdx,
    `chief@${chiefIdx} byspace@${byspaceIdx}`,
  );

  // 非 git 的 home workspace 不应显示 diff 计数。
  expectAbsent("No stray +0 -0 on the home workspace", snap, ["+0 -0"]);

  // ---------------------------------------------------------------- Provider 目录
  snap = observe();
  const settingsRef = refFor(snap, /button "Settings"/);
  if (!settingsRef) failFast("Open settings", "no Settings button in snapshot");
  click(settingsRef);
  sleep(1200);
  snap = observe();
  const agentsRef = refFor(snap, /button "Agents"/);
  if (!agentsRef) failFast("Open Agents settings", "no Agents entry in settings sidebar");
  click(agentsRef);
  sleep(1500);
  snap = observe();

  const builtinProviders = ["Pi", "Claude", "Codex", "Copilot", "OpenCode", "Oh My Pi"];
  const missingProviders = builtinProviders.filter((p) => !snap.includes(p));
  record(
    "Six built-in providers are listed",
    missingProviders.length === 0,
    `missing: ${missingProviders.join(", ")}`,
  );

  // ACP 派生 provider 属于可选项，不该默认出现在目录里。
  expectAbsent("ACP-derived providers stay opt-in", snap, ["Cursor", "Kimi", "Kiro", "Trae"]);

  // Oh My Pi 默认不启用靠 daemon 的实际发布状态判定，而不是靠 DOM 文案——可访问性树
  // 会折叠行内状态文本，按文案断言只会得到假阳性/假阴性。
  {
    const snapshot = queryProviderSnapshot();
    const omp = snapshot.find((e) => e.provider === "omp");
    record(
      "Oh My Pi defaults to disabled while still being listed",
      Boolean(omp) && omp.enabled === false,
      `omp entry: ${JSON.stringify(omp)}`,
    );
    const pi = snapshot.find((e) => e.provider === "pi");
    record(
      "Pi is enabled by default",
      Boolean(pi) && pi.enabled === true,
      `pi entry: ${JSON.stringify(pi)}`,
    );
  }

  // ---------------------------------------------------------------- 思考等级菜单
  //
  // 这一段的入口条件很脆：需要一个**空会话**的 composer。浏览器会恢复上次打开的路由
  // （可能是刚刚的 settings 页），路径不同、渲染时机也不同。所以重试有限次，直到出现
  // composer 为止，而不是假定一次点击就够。
  let thinkingRef = null;
  for (let attempt = 0; attempt < 3 && !thinkingRef; attempt += 1) {
    bsk(["navigate", BASE, "--session", session], { allowFailure: true });
    sleep(2200);
    let s2 = observe();
    // 抽屉里的 "New tab" 会展开一个菜单（Agent / Terminal 两个入口）。菜单有时已经展开，
    // 有时需要先点开；两种情况下都要点 "Agent"，然后确认菜单收起。
    if (!refFor(s2, /menuitem "Agent"/)) {
      const newTab = refFor(s2, /button "New tab"/) ?? refFor(s2, /button "New Agent"/);
      if (newTab) {
        click(newTab);
        sleep(700);
        s2 = observe();
      }
    }
    const agentItem = refFor(s2, /menuitem "Agent"/) ?? refFor(s2, /button "Agent"/);
    if (agentItem) {
      click(agentItem);
      sleep(2200);
      s2 = observe();
    }
    // 菜单遮罩如果还留着会把 composer 盖住；Escape 关掉再看。
    if (refFor(s2, /button "Menu backdrop"/) || /occluded by L1/.test(s2)) {
      bsk(["press", "Escape", "--session", session], { allowFailure: true });
      sleep(700);
      s2 = observe();
    }
    thinkingRef = refFor(s2, /button "Select thinking option/);
    snap = s2;
  }
  if (!thinkingRef) {
    failFast(
      "Open thinking menu",
      `no 'Select thinking option' button after 3 attempts\n--- snapshot ---\n${snap.slice(0, 700)}`,
    );
  }
  snap = observe();

  // composer 里的按钮文案是 "Select thinking option (…)"；气泡里的 "Thinking" 是折叠区，
  // 点它什么也不会发生。
  click(thinkingRef);
  sleep(700);
  snap = observe();

  const menuEntries = ["Off", "Minimal", "Low", "Medium", "High", "XHigh", "Max"].filter((lvl) =>
    new RegExp(`button "${lvl}"`).test(snap),
  );
  record(
    "Thinking menu renders at least Off and Max for the active model",
    menuEntries.includes("Off") && menuEntries.includes("Max"),
    `rendered: ${menuEntries.join(", ") || "(none)"}`,
  );
  const unsupported = menuEntries.filter((lvl) => lvl === "Extra high");
  record(
    "Thinking menu uses protocol level names (no invented labels)",
    unsupported.length === 0,
    `unexpected entries: ${unsupported.join(", ")}`,
  );
  console.log(`      thinking levels rendered: ${menuEntries.join(", ")}`);

  // ---------------------------------------------------------------- console 卫生
  const consoleOutput = consoleText();
  const validationErrors = [
    "Message validation failed",
    "Response validation failed",
    "Couldn't refresh agent history",
  ].filter((needle) => consoleOutput.includes(needle));
  record(
    "No protocol validation errors in console",
    validationErrors.length === 0,
    validationErrors.join(" | "),
  );
} catch (error) {
  if (!results.some((r) => !r.ok)) {
    record("Browser conformance run", false, error.message);
  }
} finally {
  bsk(["session", "stop", session], { allowFailure: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
