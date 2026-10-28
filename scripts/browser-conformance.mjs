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

import { execFileSync, spawnSync } from "node:child_process";
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
function ensureSidebarVisible() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snap = observe();
    if (refFor(snap, /button "Close menu"/)) return snap;
    const opener = refFor(snap, /button "Open menu"/);
    if (!opener) return snap;
    click(opener);
    sleep(700);
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
function dismissOverlays(snapshot) {
  let current = snapshot;
  for (let guard = 0; guard < 5; guard += 1) {
    // Two different things cover the composer here: the sidebar overlay on a compact layout (its
    // affordance is "Close menu") and the workspace actions sheet that opens on top of it (no close
    // button — Escape is the only way out). Handle both, and stop as soon as nothing is on top.
    const closer = refFor(current, /button "(Close menu|Close|Done)"/);
    const covered = /^\s*L\d+ (modal|dialog|sheet) /m.test(current);
    if (!closer && !covered) break;
    if (closer) {
      click(closer);
    } else {
      bsk(["press", "Escape", "--session", session], { allowFailure: true });
    }
    sleep(700);
    current = observe();
  }
  return current;
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
  bsk(["debug", "start", "--session", session, "--name", "browser-conformance"], {
    allowFailure: true,
  });
  // Start from a clean host registry.
  //
  // The app boots from localStorage first and only then falls back to the daemon's same-origin
  // connection hint, and `registryHasConnection` matches by endpoint — so a host record left by an
  // earlier daemon on the same address (a temp home, a reset server-id) is kept and never
  // re-probed. The run then measures that stale record instead of the daemon under test, reporting
  // the empty sidebar it produces as four product failures.
  bsk(["navigate", BASE, "--session", session], { allowFailure: true });
  bsk(["evaluate", "localStorage.clear()", "--session", session], { allowFailure: true });
  bsk(["navigate", BASE, "--session", session]);
  sleep(2500);
  // The app restores the last route. When that route names a workspace the daemon no longer has — an archived one,
  // or a temp workspace a previous run created — the app shows "Workspace unavailable" and the composer never
  // appears, so every check downstream fails for a reason unrelated to what it measures. Back out and land on the
  // shell instead of reporting those failures.
  for (let guard = 0; guard < 3; guard += 1) {
    const current = observe();
    if (!current.includes("Workspace unavailable")) break;
    const back = refFor(current, /button "Back"/);
    if (!back) break;
    click(back);
    sleep(1500);
  }

  // ---------------------------------------------------------------- 侧边栏结构
  let snap = ensureSidebarVisible();

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
  snap = ensureSidebarVisible();
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
  // The thinking button lives in a workspace composer and only exists once a model is chosen — it
  // lists the levels *that model* supports. So this walks to a workspace, clears whatever overlay
  // is on top, and picks the first model the catalog offers, which is the entry a user reaches too.
  //
  // It navigates by route instead of clicking through the sidebar: from the empty-project screen a
  // sidebar press does not move, and the "New tab → Agent" dance ended on that same screen with an
  // overlay on top on every attempt.
  let s2 = dismissOverlays(observe());
  const workspaceRoute = openAWorkspaceRoute();
  if (workspaceRoute) {
    bsk(["navigate", workspaceRoute, "--session", session], { allowFailure: true });
    sleep(2800);
    s2 = dismissOverlays(observe());
  }
  let chosenModelId = null;
  if (/button "Select model \(Select model\)"/.test(s2)) {
    click(refFor(s2, /button "Select model \(Select model\)"/));
    sleep(1300);
    const modelSnapshot = observe();
    const firstModel = refFor(
      modelSnapshot,
      /button "[^"]+ [^"]*\/\S+ Create profile from this model"/,
    );
    if (firstModel) {
      // The entry is labelled "<name> <provider>/<modelId>", and that id is what the provider
      // catalog is keyed by — the check compares the rendered menu against the model's own
      // declared levels, so it has to know which model got picked.
      const entryLabel = modelSnapshot.match(
        /button "([^"]+ [^"]*\/\S+) Create profile from this model"/,
      );
      chosenModelId = entryLabel ? entryLabel[1].split(/\s+/).pop() : null;
      click(firstModel);
      sleep(1600);
      s2 = dismissOverlays(observe());
    }
  }
  const thinkingRef = refFor(s2, /button "Select thinking option/);
  snap = s2;
  if (!thinkingRef) {
    const reachable = bsk(["observe", "--session", session], { allowFailure: true });
    failFast(
      "Open thinking menu",
      `no 'Select thinking option' button after 3 attempts\n` +
        `unavailable screen: ${reachable.includes("Workspace unavailable")}\n` +
        `--- snapshot ---\n${snap.slice(0, 900)}`,
    );
  }
  snap = observe();

  // composer 里的按钮文案是 "Select thinking option (…)"；气泡里的 "Thinking" 是折叠区，
  // 点它什么也不会发生。
  click(thinkingRef);
  sleep(700);
  snap = observe();

  // The menu must list exactly what the selected model declares, not a fixed ladder: models differ
  // (one supports off/low/high/max, another low/medium/high/xhigh/max), and a hardcoded list either
  // invents a level the model rejects or hides one it accepts.
  const declared = (() => {
    if (!chosenModelId) return null;
    const entry = queryProviderSnapshot().find(
      (provider) =>
        Array.isArray(provider.models) &&
        provider.models.some((model) => model.id === chosenModelId),
    );
    const model = entry?.models?.find((candidate) => candidate.id === chosenModelId);
    return model?.thinkingOptions?.map((option) => option.id) ?? null;
  })();
  const knownLabels = ["Off", "Minimal", "Low", "Medium", "High", "Extra high", "Max"];
  const menuEntries = knownLabels.filter((lvl) => new RegExp(`button "${lvl}"`).test(snap));
  // Any level label the menu shows that is not one of the protocol's names — a locally invented
  // word like "XHigh" rendered raw, or the old "Extra high" spelling drifting — is a mismatch
  // between the daemon's vocabulary and the app's.
  const unknownEntries = [
    ...snap.matchAll(/button "(XHigh|Xhigh|Maximal|ExtraHigh|Off \(|Minimal \(|None)"/g),
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
