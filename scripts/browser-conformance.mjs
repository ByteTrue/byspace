#!/usr/bin/env node
/**
 * 浏览器端一致性地毯检查（Playwright 驱动无头 Chromium）。
 *
 * 为什么需要它：`scripts/go-parity-audit.mjs` 只能证明「协议字段被解析了」。
 * 但「思考等级菜单列出了这个模型不支持的档位」「工具调用卡片根本没渲染」这类问题，
 * 字段全对、Schema 全过、单测全绿，只有在真浏览器里点开菜单才看得见。
 *
 * 用法：node scripts/browser-conformance.mjs [--base http://127.0.0.1:6778]
 *
 * 每项检查都会：
 *   1. 用 Playwright 操作真实 UI（无头 Chromium，不碰你自己的浏览器）；
 *   2. 对可访问性快照文本（ariaSnapshot）做断言；
 *   3. 收集 console，任何 `Message validation failed` / `Response validation failed`
 *      都记为硬失败（这类错误意味着守护进程发的 payload 与协议不符）。
 *
 * 已知不覆盖：滚动是否卡顿、动画是否流畅、真实拖拽手势——这些只能人眼看。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

/** Resolved from this repo so the probe subprocess can require the same client the app uses. */
const WS_MODULE = createRequire(import.meta.url).resolve("ws");

const BASE = (() => {
  const idx = process.argv.indexOf("--base");
  return idx >= 0 ? process.argv[idx + 1] : "http://127.0.0.1:6778";
})();

const results = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// The browser. Headless Chromium from the repo's Playwright: the check must run wherever the
// audit runs, and it must not drive (or clear the storage of) the user's own browser. The page's
// console is collected from the start so a validation error during boot is not missed.
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const consoleLines = [];
page.on("console", (message) => consoleLines.push(message.text()));
page.on("pageerror", (error) => consoleLines.push(String(error)));

/** The page's accessibility tree as text, e.g. `- button "Close menu" [expanded]`. */
const observe = () => page.locator("body").ariaSnapshot();
const button = (name) => page.getByRole("button", { name }).first();
const hasButton = async (name) => (await page.getByRole("button", { name }).count()) > 0;

/** 直接从 daemon 读取 provider 快照——UI 只是它的投影。 */
function queryProviderSnapshot() {
  const script = `
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(${JSON.stringify(BASE.replace(/^http/, "ws") + "/ws")});
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

/**
 * 确保侧栏可见。
 *
 * 应用会从存储恢复上次的会话视图（全屏），此时侧栏是收起的——快照里只有 "Open menu"。
 * 侧栏的开合是浏览器恢复的状态，不是本脚本设置的，所以每个断言段之前都要先把它摆成
 * 已知状态，否则失败信息只是在报「侧栏没开」，和被测行为无关。
 */
async function ensureSidebarVisible() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hasButton("Close menu")) return observe();
    if (!(await hasButton("Open menu"))) return observe();
    await button("Open menu").click();
    await sleep(700);
  }
  return observe();
}

/**
 * Drives the two state transitions against the live daemon and reports what the client would be told.
 *
 * Runs over a WebSocket rather than the UI: the claim being checked is "which updates does the daemon emit", and
 * recreating that from clicks would test the sidebar's rendering on top of it. The two defects this guards were both
 * in the emitted updates, and both were invisible to the field audit.
 */
function runWorkspaceStateTransitions() {
  const result = {
    archivedKeptProject: false,
    archivedDetail: "",
    removedProject: false,
    removedDetail: "",
  };

  // A throwaway repo so the transition does not touch the user's real projects.
  const root = mkdtempSync(path.join(tmpdir(), "byspace-seq-"));
  const repoPath = path.join(root, "repo");
  mkdirSync(repoPath, { recursive: true });
  const git = (args) => spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "e2e@example.com"]);
  git(["config", "user.name", "e2e"]);
  writeFileSync(path.join(repoPath, "README.md"), "seed\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);

  const script = `
const WebSocket = require(${JSON.stringify(WS_MODULE)});
const ws = new WebSocket(${JSON.stringify(BASE.replace(/^http/, "ws") + "/ws")});
const repoPath = ${JSON.stringify(repoPath)};
const out = { updates: [], archived: null, removed: null };
const send = (message) => ws.send(JSON.stringify({ type: "session", message }));
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", clientId: "seq-probe", protocolVersion: 1 })));
ws.on("message", (raw) => {
  const env = JSON.parse(raw.toString());
  const payload = env?.message?.payload;
  if (payload?.status === "server_info") {
    send({ type: "project.add.request", requestId: "p", cwd: repoPath });
    return;
  }
  if (env?.message?.type === "project.add.response") {
    send({ type: "workspace.create.request", requestId: "w", cwd: repoPath, source: { kind: "path", path: repoPath } });
    return;
  }
  if (env?.message?.type === "workspace.create.response") {
    const wsId = payload?.workspace?.id;
    // The project this workspace belongs to. archive_workspace_response does not carry it (the
    // protocol has no field for it) and the remove update deliberately omits projectId, so the
    // only place it appears is here and in the upsert.
    globalThis.__projectId = payload?.workspace?.projectId ?? null;
    globalThis.__wsId = wsId;
    send({ type: "archive_workspace_request", requestId: "a", workspaceId: wsId });
    return;
  }
  // project.update carries the project-table changes. The directory replica is driven by it, so a
  // project removal that arrives this way clears the sidebar just as a workspace update would.
  if (env?.message?.type === "workspace_update" || env?.message?.type === "project.update") {
    out.updates.push({ ...payload, __messageType: env.message.type });
  }
  if (env?.message?.type === "archive_workspace_response") {
    out.archived = { workspaceId: payload.workspaceId, error: payload.error };
    send({ type: "project.remove.request", requestId: "r", projectId: globalThis.__projectId });
    return;
  }
  if (env?.message?.type === "project.remove.response") {
    out.removed = { accepted: payload.accepted, removedWorkspaceIds: payload.removedWorkspaceIds };
    console.log(JSON.stringify(out));
    process.exit(0);
  }
});
ws.on("error", (error) => { console.error(error.message); process.exit(2); });
setTimeout(() => { console.log(JSON.stringify({ ...out, timeout: true })); process.exit(1); }, 45000);
`;
  const probePath = path.join(root, "probe.cjs");
  writeFileSync(probePath, script);

  try {
    const run = spawnSync(process.execPath, [probePath], { encoding: "utf8", timeout: 60000 });
    const line = (run.stdout ?? "").trim().split("\n").findLast(Boolean) ?? "";
    if (!line) {
      result.archivedDetail = `probe produced no output: ${(run.stderr ?? "").slice(0, 300)}`;
      result.removedDetail = result.archivedDetail;
      return result;
    }
    const observed = JSON.parse(line);
    const archiveUpdate = (observed.updates ?? []).find(
      (u) => u.kind === "remove" && u.id === observed.archived?.workspaceId,
    );
    // The project row survives only if the client is told the project still exists; without this field it deletes the
    // group along with its last workspace.
    //
    // The update deliberately carries no `projectId` — that field means "this is a project removal" to the client —
    // so the empty project's own id is what proves the field was populated.
    const archivedProjectId = archiveUpdate?.emptyProject?.projectId ?? null;
    result.archivedKeptProject = Boolean(archiveUpdate) && Boolean(archivedProjectId);
    result.archivedDetail = archiveUpdate
      ? `archive update: ${JSON.stringify(archiveUpdate).slice(0, 220)}`
      : `no remove update for the archived workspace; updates=${JSON.stringify(observed.updates ?? []).slice(0, 220)}`;

    // The removal is announced on the workspace channel; a response alone leaves the sidebar showing what the daemon
    // already archived.
    // Either form proves the client was told: a workspace update naming the project it took with
    // it, or a project-table removal. Which one arrives depends on whether any live workspace was
    // left when the removal ran — here none is, because the step above already archived the only one.
    const removalUpdate = (observed.updates ?? []).find(
      (u) =>
        (u.removedProjectId && u.removedProjectId === archivedProjectId) ||
        (u.__messageType === "project.update" &&
          u.kind === "remove" &&
          u.projectId === archivedProjectId),
    );
    result.removedProject = Boolean(removalUpdate) && observed.removed?.accepted === true;
    result.removedDetail = removalUpdate
      ? `removal update: ${JSON.stringify(removalUpdate).slice(0, 220)}`
      : `no update carried removedProjectId; response=${JSON.stringify(observed.removed)}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return result;
}

/**
 * Closes whatever sheet, drawer or menu is covering the surface and returns the resulting snapshot.
 *
 * A workspace opened on a compact layout puts the sidebar in an overlay that covers the composer,
 * and a leftover menu from the previous step covers it too. Both are dismissed the same way: Escape,
 * then the explicit close affordance when the snapshot still shows an overlay.
 */
async function dismissOverlays() {
  for (let guard = 0; guard < 5; guard += 1) {
    // Two different things cover the composer here: the sidebar overlay on a compact layout (its
    // affordance is "Close menu") and the workspace actions sheet that opens on top of it (no close
    // button — Escape is the only way out). Handle both, and stop as soon as nothing is on top.
    const closer = /^(Close menu|Close|Done)$/;
    const covered = (await page.getByRole("dialog").count()) > 0;
    const hasCloser = await hasButton(closer);
    if (!hasCloser && !covered) break;
    if (hasCloser) {
      await button(closer).click();
    } else {
      await page.keyboard.press("Escape");
    }
    await sleep(700);
  }
  return observe();
}

/**
 * The route that opens one existing workspace, or null when the daemon has none.
 *
 * `serverId` comes from `/health`; the workspace id from the daemon over the socket, because it is
 * the only place that knows which workspaces exist. Built rather than clicked: from the
 * empty-project screen a sidebar row press does not navigate.
 */
function openAWorkspaceRoute() {
  const serverId = (() => {
    try {
      const body = execFileSync("curl", ["-s", "-m", "5", `${BASE}/health`], { encoding: "utf8" });
      return JSON.parse(body)?.serverId ?? null;
    } catch {
      return null;
    }
  })();
  if (!serverId) return null;

  const root = mkdtempSync(path.join(tmpdir(), "byspace-wks-"));
  const probePath = path.join(root, "wks.cjs");
  writeFileSync(
    probePath,
    `
const WebSocket = require(${JSON.stringify(WS_MODULE)});
const ws = new WebSocket(${JSON.stringify(BASE.replace(/^http/, "ws") + "/ws")});
const send = (message) => ws.send(JSON.stringify({ type: "session", message }));
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", clientId: "wks-probe", protocolVersion: 1 })));
ws.on("message", (raw) => {
  const env = JSON.parse(raw.toString());
  if (env?.message?.type === "fetch_workspaces_response") {
    const id = env.message.payload?.entries?.[0]?.id ?? null;
    console.log(JSON.stringify({ id }));
    process.exit(0);
  }
  if (env?.message?.payload?.status === "server_info") {
    send({ type: "fetch_workspaces_request", requestId: "w", page: { limit: 1 } });
  }
});
setTimeout(() => { console.log(JSON.stringify({ id: null })); process.exit(0); }, 15000);
`,
  );
  try {
    const run = spawnSync(process.execPath, [probePath], { encoding: "utf8", timeout: 60000 });
    const line = (run.stdout ?? "").trim().split("\n").findLast(Boolean) ?? "";
    const workspaceId = line ? JSON.parse(line).id : null;
    if (!workspaceId) return null;
    return `${BASE}/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}`;
  } catch {
    return null;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function failFast(name, message) {
  record(name, false, message);
  throw new Error(`${name}: ${message}`);
}

// ------------------------------------------------- 归档与项目移除的状态转移
//
// 这两条不是"字段有没有发"，而是"一串操作之后侧栏该看到什么"。它们各自的组成都正确
// （归档清理了 agent 与终端、移除归档了项目和它的工作区），错在中间那条广播：归档时没带
// `emptyProject`，前端删掉最后一个工作区就顺手删掉了项目组；移除项目时根本没有广播，侧栏
// 一直显示已经归档的项目。静态字段对账看不见这类缺陷，因为 workspace_update 的 payload 是
// 判别联合，被当作 opaque 跳过了。
const seq = runWorkspaceStateTransitions();
record(
  "Archiving the last workspace keeps its project",
  seq.archivedKeptProject,
  seq.archivedDetail,
);
record("Removing a project clears it from the directory", seq.removedProject, seq.removedDetail);

try {
  // Start from a clean host registry.
  //
  // The app boots from localStorage first and only then falls back to the daemon's same-origin
  // connection hint, and `registryHasConnection` matches by endpoint — so a host record left by an
  // earlier daemon on the same address (a temp home, a reset server-id) is kept and never
  // re-probed. The run then measures that stale record instead of the daemon under test, reporting
  // the empty sidebar it produces as four product failures.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(2500);
  // The app restores the last route. When that route names a workspace the daemon no longer has — an archived one,
  // or a temp workspace a previous run created — the app shows "Workspace unavailable" and the composer never
  // appears, so every check downstream fails for a reason unrelated to what it measures. Back out and land on the
  // shell instead of reporting those failures.
  for (let guard = 0; guard < 3; guard += 1) {
    const current = await observe();
    if (!current.includes("Workspace unavailable") || !(await hasButton("Back"))) break;
    await button("Back").click();
    await sleep(1500);
  }

  // ---------------------------------------------------------------- 侧边栏结构
  let snap = await ensureSidebarVisible();

  expectContains("Sidebar lists the Chief home workspace", snap, ["BySpace-WorkSpace", "Chief"]);

  // Chief 子行位于 Home 项目组标题之后；这里验证两者都属于固定首位的 `home:chief` 组，
  // 不把组内父子顺序误当成 Chief 没有固定在其他项目之前。
  const chiefIdx = snap.search(/link "Chief"/);
  const homeProjectIdx = snap.search(/button "(?:\S )?BySpace-WorkSpace\b/);
  const homeGroupExists =
    (await page.locator('[data-testid="sidebar-project-row-home:chief"]').count()) === 1;
  record(
    "Chief home project is pinned above ordinary projects",
    homeGroupExists && homeProjectIdx >= 0 && chiefIdx > homeProjectIdx,
    `homeProject@${homeProjectIdx} chief@${chiefIdx} homeGroup=${homeGroupExists}`,
  );

  // 非 git 的 home workspace 不应显示 diff 计数。
  expectAbsent("No stray +0 -0 on the home workspace", snap, ["+0 -0"]);

  // ---------------------------------------------------------------- Provider 目录
  await ensureSidebarVisible();
  if (!(await hasButton("Settings"))) failFast("Open settings", "no Settings button in snapshot");
  await button("Settings").click();
  await sleep(1200);
  if (!(await hasButton("Agents")))
    failFast("Open Agents settings", "no Agents entry in settings sidebar");
  await button("Agents").click();
  await sleep(1500);
  snap = await observe();

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
  // The thinking button lives in a workspace composer and only exists once a model is chosen — it
  // lists the levels *that model* supports. So this walks to a workspace, clears whatever overlay
  // is on top, and picks the first model the catalog offers, which is the entry a user reaches too.
  //
  // It navigates inside the app (history push) instead of loading the URL: a cold load of a
  // workspace URL lands on the home screen.
  let s2 = await dismissOverlays();
  const workspaceRoute = openAWorkspaceRoute();
  if (workspaceRoute) {
    await page.evaluate((route) => {
      history.pushState({}, "", new URL(route).pathname);
      dispatchEvent(new PopStateEvent("popstate"));
    }, workspaceRoute);
    await sleep(2800);
    s2 = await dismissOverlays();
  }
  // The picker lists providers first ("Claude 15 models"); a provider opens its models, each
  // labelled "<name> <description> Create profile from this model". The chosen model shows up as
  // the composer button's label, which is matched back to the catalog to learn its declared levels.
  let chosenModel = null;
  if (await hasButton("Select model (Select model)")) {
    await button("Select model (Select model)").click();
    await sleep(1300);
    const providerEntry = /^.+ \d+ models?$/;
    if (await hasButton(providerEntry)) {
      await button(providerEntry).click();
      await sleep(1200);
    }
    const modelEntry = /^.+ Create profile from this model$/;
    if (await hasButton(modelEntry)) {
      await button(modelEntry).click();
      await sleep(1600);
      s2 = await dismissOverlays();
      const selected = s2.match(/button "Select model \(([^)]+)\)"/)?.[1] ?? null;
      chosenModel =
        queryProviderSnapshot()
          .flatMap((provider) => (Array.isArray(provider.models) ? provider.models : []))
          .find((model) => model.label === selected || model.id === selected) ?? null;
    }
  }
  const thinkingName = /^Select thinking option/;
  if (!(await hasButton(thinkingName))) {
    failFast(
      "Open thinking menu",
      `no 'Select thinking option' button\n` +
        `unavailable screen: ${s2.includes("Workspace unavailable")}\n` +
        `--- snapshot ---\n${s2.slice(0, 900)}`,
    );
  }

  // composer 里的按钮文案是 "Select thinking option (…)"；气泡里的 "Thinking" 是折叠区，
  // 点它什么也不会发生。
  await button(thinkingName).click();
  await sleep(700);
  snap = await observe();

  // The menu must list exactly what the selected model declares, not a fixed ladder: models differ
  // (one supports off/low/high/max, another low/medium/high/xhigh/max), and a hardcoded list either
  // invents a level the model rejects or hides one it accepts.
  const declared = chosenModel?.thinkingOptions?.map((option) => option.id) ?? null;
  const chosenModelId = chosenModel?.id ?? null;
  const entryRole = "(?:button|menuitem|menuitemradio|option)";
  const knownLabels = [
    "Off",
    "Minimal",
    "Low",
    "Medium",
    "High",
    "Extra high",
    "Max",
    "Ultra code",
  ];
  const menuEntries = knownLabels.filter((lvl) => new RegExp(`${entryRole} "${lvl}"`).test(snap));
  // Any level label the menu shows that is not one of the protocol's names — a locally invented
  // word like "XHigh" rendered raw, or the old "Extra high" spelling drifting — is a mismatch
  // between the daemon's vocabulary and the app's.
  const unknownEntries = [
    ...snap.matchAll(
      new RegExp(`${entryRole} "(XHigh|Xhigh|Maximal|ExtraHigh|Off \\(|Minimal \\(|None)"`, "g"),
    ),
  ].map((match) => match[1]);
  record(
    "Thinking menu renders the levels the selected model declares",
    Boolean(declared) && declared.length === menuEntries.length,
    `model=${chosenModelId ?? "(unresolved)"} declared=${JSON.stringify(declared)} rendered=${JSON.stringify(menuEntries)}`,
  );
  record(
    "Thinking menu uses protocol level names (no invented labels)",
    unknownEntries.length === 0 && menuEntries.length > 0,
    `unexpected entries: ${JSON.stringify(unknownEntries)}`,
  );
  console.log(`      thinking levels rendered: ${menuEntries.join(", ")}`);

  // ---------------------------------------------------------------- console 卫生
  const consoleOutput = consoleLines.join("\n");
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
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
