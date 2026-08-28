import { expect, test, type Page } from "@playwright/test";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(__dirname, "../../../..");
const wranglerCLI = createRequire(__filename).resolve("wrangler");

interface DaemonHarness {
  name: string;
  home: string;
  project: string;
  port: number;
  process?: ChildProcess;
  serverId?: string;
  piPIDFile: string;
  piInvocationLog: string;
  piLaunchCountFile: string;
  output: string;
}

let daemonBinary: string;
let executablePath: string;
let temporaryRoot: string;
let relayPort: number;
let relayProcess: ChildProcess | undefined;
let relayOutput = "";
let direct: DaemonHarness;
let remote: DaemonHarness;

function daemonEnvironment(daemon: DaemonHarness): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${executablePath}${delimiter}${process.env.PATH ?? ""}`,
    BYSPACE_E2E_PI_PID: daemon.piPIDFile,
    BYSPACE_E2E_PI_INVOCATION_LOG: daemon.piInvocationLog,
    BYSPACE_E2E_PI_LAUNCH_COUNT: daemon.piLaunchCountFile,
  };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (process.platform === "win32") {
    throw new Error("Go daemon browser tracer currently requires a POSIX test host");
  }
  temporaryRoot = await mkdtemp(join(tmpdir(), "byspace-browser-multi-host-"));
  executablePath = join(temporaryRoot, "bin");
  daemonBinary = join(temporaryRoot, "byspace");
  const directHome = join(temporaryRoot, "direct-home");
  const remoteHome = join(temporaryRoot, "remote-home");
  const directProject = join(temporaryRoot, "direct-project");
  const remoteProject = join(temporaryRoot, "remote-project");
  await Promise.all(
    [executablePath, directHome, remoteHome, directProject, remoteProject].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  execFileSync("go", ["build", "-o", daemonBinary, "./cmd/byspace"], {
    cwd: join(repositoryRoot, "go"),
    stdio: "inherit",
  });
  const fakePi = join(executablePath, "pi");
  await writeFile(
    fakePi,
    await readFile(join(repositoryRoot, "fixtures", "pi", "fake-rpc.mjs"), "utf8"),
    "utf8",
  );
  await chmod(fakePi, 0o755);

  relayPort = await availablePort();
  await startRelay();

  direct = {
    name: basename(directProject),
    home: directHome,
    project: directProject,
    port: await availablePort(),
    piPIDFile: join(temporaryRoot, "direct-pi.pid"),
    piInvocationLog: join(temporaryRoot, "direct-pi-invocations.jsonl"),
    piLaunchCountFile: join(temporaryRoot, "direct-pi-launch-count"),
    output: "",
  };
  remote = {
    name: basename(remoteProject),
    home: remoteHome,
    project: remoteProject,
    port: await availablePort(),
    piPIDFile: join(temporaryRoot, "remote-pi.pid"),
    piInvocationLog: join(temporaryRoot, "remote-pi-invocations.jsonl"),
    piLaunchCountFile: join(temporaryRoot, "remote-pi-launch-count"),
    output: "",
  };
  await Promise.all([startDaemon(direct), startDaemon(remote, `ws://127.0.0.1:${relayPort}`)]);
});

test.afterAll(async () => {
  const failures: unknown[] = [];
  const daemonStops = await Promise.allSettled([stopDaemon(direct), stopDaemon(remote)]);
  for (const result of daemonStops) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  try {
    await stopRelay();
  } catch (error) {
    failures.push(error);
  }
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  if (failures.length > 0) {
    throw new AggregateError(failures, "multi-host E2E cleanup failed");
  }
});

test("imports an authenticated Relay host beside the direct host", async ({ page }) => {
  test.setTimeout(180_000);
  const rootURL = `http://localhost:${direct.port}`;
  const browserErrors: string[] = [];
  const expectedRelayOutageErrors: string[] = [];
  const browserConsole: string[] = [];
  let relayOutageActive = false;
  const requestedURLs: string[] = [];
  const relayFrames: Array<string | Buffer> = [];
  let relaySocketClosures = 0;
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    browserConsole.push(text);
    if (message.type() !== "error") return;
    if (
      relayOutageActive &&
      text.includes(`ws://127.0.0.1:${relayPort}/ws`) &&
      text.includes("ERR_CONNECTION_REFUSED")
    ) {
      expectedRelayOutageErrors.push(text);
      return;
    }
    browserErrors.push(text);
  });
  page.on("request", (request) => requestedURLs.push(request.url()));
  page.on("websocket", (socket) => {
    if (!socket.url().includes(`127.0.0.1:${relayPort}`)) return;
    socket.on("framesent", ({ payload }) => relayFrames.push(payload));
    socket.on("framereceived", ({ payload }) => relayFrames.push(payload));
    socket.on("close", () => {
      relaySocketClosures += 1;
    });
  });

  await page.goto(rootURL);
  await expect(visibleExactText(page, direct.name)).toBeVisible();

  const pairing = await getPairingOffer(remote);
  const offerURL = new URL(pairing.url);
  await page.goto(`${rootURL}/${offerURL.hash}`);

  await expect
    .poll(() => page.evaluate(() => globalThis.localStorage.getItem("@paseo:daemon-registry")))
    .toContain(pairing.offer.serverId);
  await expect(visibleExactText(page, remote.name)).toBeVisible({ timeout: 20_000 });
  await visibleExactText(page, remote.name).click();
  await expect(page).toHaveURL(new RegExp(`/h/${pairing.offer.serverId}/workspace/`));
  await expectHostStatus(page, pairing.offer.serverId, "Connection status: online");

  const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(composer).toBeEditable();
  await page.getByText("Select model", { exact: true }).click();
  await page.getByText("Default", { exact: true }).last().click();
  await composer.fill("remote browser tracer");
  await composer.press("Enter");
  await expect(
    page.getByTestId("user-message").getByText("remote browser tracer", { exact: true }),
  ).toBeVisible();
  await expect(visibleExactText(page, "from fake pi")).toBeVisible();
  const remoteAgentID = await waitForSingleIdleAgent(remote);

  await page.reload();
  await expect(
    page.getByTestId("user-message").getByText("remote browser tracer", { exact: true }),
  ).toBeVisible();

  const closuresBeforeRelayOutage = relaySocketClosures;
  relayOutageActive = true;
  await stopRelay();
  await expect.poll(() => relaySocketClosures).toBeGreaterThan(closuresBeforeRelayOutage);
  await expectHostStatus(
    page,
    pairing.offer.serverId,
    /Connection status: (connecting|offline|error)/,
  );

  await expect(visibleExactText(page, direct.name)).toBeVisible();
  await visibleExactText(page, direct.name).click();
  await expect(page).toHaveURL(new RegExp(`/h/${direct.serverId}/workspace/`));
  await expectHostStatus(page, direct.serverId ?? "", "Connection status: online");
  await expect(page.getByRole("alert").filter({ hasText: /offline|connection/i })).toHaveCount(0);
  const directComposer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(directComposer).toBeEditable();
  await directComposer.fill("direct browser tracer during relay outage");
  await directComposer.press("Enter");
  await expect(
    page
      .getByTestId("user-message")
      .getByText("direct browser tracer during relay outage", { exact: true }),
  ).toBeVisible();
  await expect(visibleExactText(page, "from fake pi")).toBeVisible();
  const directAgentID = await waitForSingleIdleAgent(direct);

  const framesBeforeRelayRestart = relayFrames.length;
  await startRelay();
  await waitForRelayReady(remote);
  relayOutageActive = false;
  await expect
    .poll(() => relayFrames.length, { timeout: 40_000 })
    .toBeGreaterThan(framesBeforeRelayRestart + 4);
  await expectHostStatus(page, pairing.offer.serverId, "Connection status: online", 40_000);
  await expect(visibleExactText(page, remote.name)).toBeVisible();
  await visibleExactText(page, remote.name).click();
  await expect(page).toHaveURL(new RegExp(`/h/${pairing.offer.serverId}/workspace/`));
  await expect(
    page.getByTestId("user-message").getByText("remote browser tracer", { exact: true }),
  ).toBeVisible({ timeout: 40_000 });
  const resumedComposer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(resumedComposer).toBeEditable({ timeout: 40_000 });
  await resumedComposer.fill("remote browser tracer after relay restart");
  await resumedComposer.press("Enter");
  await expect(
    page
      .getByTestId("user-message")
      .getByText("remote browser tracer after relay restart", { exact: true }),
  ).toBeVisible();
  await expect(visibleExactTexts(page, "from fake pi")).toHaveCount(2);
  expect(await waitForSingleIdleAgent(remote)).toBe(remoteAgentID);

  const stableRemoteServerID = remote.serverId;
  const framesBeforeDaemonRestart = relayFrames.length;
  await stopDaemon(remote);
  await expectHostStatus(
    page,
    pairing.offer.serverId,
    /Connection status: (connecting|offline|error)/,
  );
  await startDaemon(remote, `ws://127.0.0.1:${relayPort}`);
  expect(remote.serverId).toBe(stableRemoteServerID);
  const recoveredPairing = await waitForRelayReady(remote);
  expect(recoveredPairing.offer).toEqual(pairing.offer);
  await expect
    .poll(() => relayFrames.length, { timeout: 40_000 })
    .toBeGreaterThan(framesBeforeDaemonRestart + 4);
  await expectHostStatus(page, pairing.offer.serverId, "Connection status: online", 40_000);
  const daemonResumedComposer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(daemonResumedComposer).toBeEditable({ timeout: 40_000 });
  await daemonResumedComposer.fill("remote browser tracer after daemon restart");
  await daemonResumedComposer.press("Enter");
  await expect(
    page
      .getByTestId("user-message")
      .getByText("remote browser tracer after daemon restart", { exact: true }),
  ).toBeVisible();
  await expect(visibleExactTexts(page, "from fake pi")).toHaveCount(3);
  expect(await waitForSingleIdleAgent(remote)).toBe(remoteAgentID);

  const remoteTimeline = await canonicalTimeline(remote, remoteAgentID);
  const directTimeline = await canonicalTimeline(direct, directAgentID);
  expect(remoteTimeline).toEqual([
    { seqStart: 1, type: "user_message", text: "remote browser tracer" },
    { seqStart: 2, type: "assistant_message", text: "from fake pi" },
    { seqStart: 3, type: "user_message", text: "remote browser tracer after relay restart" },
    { seqStart: 4, type: "assistant_message", text: "from fake pi" },
    { seqStart: 5, type: "user_message", text: "remote browser tracer after daemon restart" },
    { seqStart: 6, type: "assistant_message", text: "from fake pi" },
  ]);
  expect(directTimeline).toEqual([
    { seqStart: 1, type: "user_message", text: "direct browser tracer during relay outage" },
    { seqStart: 2, type: "assistant_message", text: "from fake pi" },
  ]);

  const invocations = (await readFile(remote.piInvocationLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  expect(invocations.length).toBeGreaterThanOrEqual(2);
  expect(invocations.slice(1).some((args) => args.includes("--session"))).toBe(true);

  await page.reload();
  await expect(visibleExactText(page, direct.name)).toBeVisible();
  await expect(visibleExactText(page, remote.name)).toBeVisible();
  await expect(
    page
      .getByTestId("user-message")
      .getByText("remote browser tracer after daemon restart", { exact: true }),
  ).toBeVisible();

  const secret = pairing.offer.clientAuthTokenB64;
  expect(requestedURLs.every((url) => !url.includes(secret))).toBe(true);
  expect(new URL(page.url()).search).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
  expect(await page.locator("body").innerText()).not.toContain(secret);
  expect(browserConsole.join("\n")).not.toContain(secret);
  expect(relayFrames.length).toBeGreaterThan(0);
  const routedWire = relayFrames
    .map((frame) => (typeof frame === "string" ? frame : frame.toString("utf8")))
    .join("\n");
  expect(routedWire).not.toContain(secret);
  expect(routedWire).not.toContain("remote browser tracer");
  expect(routedWire).not.toContain("from fake pi");
  expect(relayOutput).not.toContain(secret);
  expect(direct.output).not.toContain(secret);
  expect(remote.output).not.toContain(secret);
  expect(
    expectedRelayOutageErrors.every((message) =>
      message.includes(`ws://127.0.0.1:${relayPort}/ws`),
    ),
  ).toBe(true);
  expect(browserErrors).toEqual([]);
});

async function expectHostStatus(
  page: Page,
  serverID: string,
  expected: string | RegExp,
  timeout = 15_000,
): Promise<void> {
  await page.getByRole("button", { name: "Hosts" }).click();
  await expect(
    page.getByTestId(`host-status-${serverID}`).filter({ visible: true }).first(),
  ).toHaveAttribute("aria-label", expected, { timeout });
  await page.keyboard.press("Escape");
}

function visibleExactTexts(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

function visibleExactText(page: Page, text: string) {
  return visibleExactTexts(page, text).last();
}

async function waitForSingleIdleAgent(daemon: DaemonHarness): Promise<string> {
  let agentID = "";
  await expect
    .poll(async () => {
      try {
        const { stdout } = await execFileAsync(
          daemonBinary,
          ["agent", "list", "--home", daemon.home, "--json"],
          { cwd: daemon.project, env: daemonEnvironment(daemon) },
        );
        const payload = JSON.parse(stdout) as {
          entries?: Array<{ agent?: { id?: string; status?: string } }>;
        };
        if (payload.entries?.length === 1 && payload.entries[0]?.agent?.status === "idle") {
          agentID = payload.entries[0].agent.id ?? "";
        }
        return agentID;
      } catch {
        return "";
      }
    })
    .toMatch(/^agt_/);
  return agentID;
}

async function waitForRelayReady(daemon: DaemonHarness): Promise<{
  url: string;
  offer: { serverId: string; clientAuthTokenB64: string };
}> {
  let pairing: Awaited<ReturnType<typeof getPairingOffer>> | undefined;
  await expect
    .poll(
      async () => {
        try {
          pairing = await getPairingOffer(daemon);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 40_000 },
    )
    .toBe(true);
  if (!pairing) throw new Error("Relay became ready without a pairing offer");
  return pairing;
}

async function canonicalTimeline(
  daemon: DaemonHarness,
  agentID: string,
): Promise<Array<{ seqStart: number; type: string; text: string }>> {
  const { stdout } = await execFileAsync(
    daemonBinary,
    ["agent", "timeline", "--home", daemon.home, "--json", agentID],
    { cwd: daemon.project, env: daemonEnvironment(daemon) },
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          seqStart: number;
          item: { type: string; text?: string; message?: string };
        },
    )
    .map((entry) => ({
      seqStart: entry.seqStart,
      type: entry.item.type,
      text: entry.item.text ?? entry.item.message ?? "",
    }));
}

async function getPairingOffer(daemon: DaemonHarness): Promise<{
  url: string;
  offer: { serverId: string; clientAuthTokenB64: string };
}> {
  const { stdout } = await execFileAsync(
    daemonBinary,
    ["pair", "--home", daemon.home, "--json", "--app-url", "https://app.byspace.cc.cd/"],
    { cwd: daemon.project, env: daemonEnvironment(daemon) },
  );
  return JSON.parse(stdout) as {
    url: string;
    offer: { serverId: string; clientAuthTokenB64: string };
  };
}

async function startDaemon(daemon: DaemonHarness, relayURL?: string): Promise<void> {
  const args = [
    "daemon",
    "start",
    "--foreground",
    "--home",
    daemon.home,
    "--listen",
    `127.0.0.1:${daemon.port}`,
    "--web-dir",
    join(repositoryRoot, "packages", "app", "dist"),
  ];
  if (relayURL) args.push("--relay-url", relayURL);
  daemon.process = spawn(daemonBinary, args, {
    cwd: daemon.project,
    env: daemonEnvironment(daemon),
    stdio: ["ignore", "pipe", "pipe"],
  });
  daemon.process.stdout?.on("data", (chunk) => {
    daemon.output += String(chunk);
  });
  daemon.process.stderr?.on("data", (chunk) => {
    daemon.output += String(chunk);
  });
  await waitForPidRecord(daemon);
  await expect
    .poll(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${daemon.port}/healthz`);
        const health = (await response.json()) as { serverId?: string };
        daemon.serverId = health.serverId;
        return daemon.serverId;
      } catch {
        return undefined;
      }
    })
    .toMatch(/^srv_/);
}

async function stopDaemon(daemon: DaemonHarness | undefined): Promise<void> {
  if (!daemon) return;
  const child = daemon.process;
  const piPID = await readPID(daemon.piPIDFile);
  const failures: unknown[] = [];
  if (child?.exitCode === null) {
    try {
      await execFileAsync(daemonBinary, ["daemon", "stop", "--home", daemon.home]);
    } catch (error) {
      failures.push(error);
      child.kill("SIGTERM");
    }
    try {
      await waitForExit(child, 10_000);
    } catch (error) {
      failures.push(error);
      child.kill("SIGKILL");
      await waitForExit(child, 5_000);
    }
  }
  daemon.process = undefined;
  if (piPID !== null) {
    try {
      await waitForProcessExit(piPID, 5_000);
    } catch (error) {
      failures.push(error);
      try {
        process.kill(piPID, "SIGKILL");
      } catch {
        // The process may have exited between the final probe and kill.
      }
      await waitForProcessExit(piPID, 5_000);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `failed to stop ${daemon.name} daemon cleanly`);
  }
}

async function startRelay(): Promise<void> {
  if (relayProcess?.exitCode === null) return;
  relayProcess = spawn(
    process.execPath,
    [
      wranglerCLI,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(relayPort),
      "--persist-to",
      join(temporaryRoot, "wrangler-state"),
      "--live-reload=false",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: join(repositoryRoot, "packages", "relay"),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  relayProcess.stdout?.on("data", (chunk) => {
    relayOutput += String(chunk);
  });
  relayProcess.stderr?.on("data", (chunk) => {
    relayOutput += String(chunk);
  });
  await waitForHTTP(`http://127.0.0.1:${relayPort}/`);
}

async function stopRelay(): Promise<void> {
  if (!relayProcess || relayProcess.exitCode !== null) {
    relayProcess = undefined;
    if (relayPort > 0) await waitForHTTPUnavailable(`http://127.0.0.1:${relayPort}/`);
    return;
  }
  const child = relayProcess;
  child.kill("SIGTERM");
  try {
    await waitForExit(child, 10_000);
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
  }
  relayProcess = undefined;
  await waitForHTTPUnavailable(`http://127.0.0.1:${relayPort}/`);
}

async function waitForPidRecord(daemon: DaemonHarness): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (daemon.process?.exitCode !== null) {
      throw new Error(`${daemon.name} daemon exited early: ${daemon.output}`);
    }
    try {
      await readFile(join(daemon.home, "byspace.pid"), "utf8");
      return;
    } catch {
      await delay(20);
    }
  }
  throw new Error(`timed out waiting for ${daemon.name} daemon: ${daemon.output}`);
}

async function waitForHTTP(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!relayProcess || relayProcess.exitCode !== null) {
      throw new Error(`Relay exited early (${relayProcess?.exitCode}): ${relayOutput}`);
    }
    try {
      await fetch(url);
      return;
    } catch {
      await delay(50);
    }
  }
  throw new Error(`timed out waiting for Relay: ${relayOutput}`);
}

async function waitForHTTPUnavailable(url: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await delay(20);
  }
  throw new Error(`Relay remained reachable at ${url}`);
}

async function readPID(path: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(path, "utf8")).trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await delay(20);
  }
  throw new Error(`process ${pid} remained alive`);
}

async function availablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate port")));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

function waitForExit(process: ChildProcess, timeoutMs: number): Promise<void> {
  if (process.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for process exit")),
      timeoutMs,
    );
    process.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
