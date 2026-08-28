import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import type { SessionOutboundMessage } from "@byspace/protocol";
import { DaemonClient } from "./daemon-client.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const canonicalRepositoryRoot = resolve(repositoryRoot);
const goRoot = join(repositoryRoot, "go");
const running: Array<{
  client?: DaemonClient;
  daemon?: ChildProcessWithoutNullStreams;
  root: string;
}> = [];

afterEach(async () => {
  await Promise.all(
    running.splice(0).map(async ({ client, daemon, root }) => {
      await client?.close().catch(() => undefined);
      if (daemon && daemon.exitCode === null) {
        daemon.kill("SIGKILL");
        await waitForExit(daemon).catch(() => undefined);
      }
      await rm(root, { recursive: true, force: true });
    }),
  );
});

test("copied DaemonClient completes the local Go Agent WebSocket flow", async () => {
  if (process.platform === "win32") {
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "byspace-go-client-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const agentCwd = join(root, "project");
  const daemonBinary = join(root, "byspace");
  const piPidFile = join(root, "pi.pid");
  const piLaunchFile = join(root, "pi-launch-count");
  await Promise.all([mkdir(home), mkdir(bin), mkdir(agentCwd)]);
  const state: {
    client?: DaemonClient;
    daemon?: ChildProcessWithoutNullStreams;
    root: string;
  } = {
    root,
  };
  running.push(state);

  await execFileAsync("go", ["build", "-o", daemonBinary, "./cmd/byspace"], {
    cwd: goRoot,
  });
  const fakePi = join(bin, "pi");
  await writeFile(
    fakePi,
    await readFile(join(repositoryRoot, "fixtures", "pi", "fake-rpc.mjs"), "utf8"),
    "utf8",
  );
  await chmod(fakePi, 0o755);

  let daemonOutput = "";
  const daemon = spawn(
    daemonBinary,
    [
      "daemon",
      "start",
      "--foreground",
      "--home",
      home,
      "--listen",
      "127.0.0.1:0",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        BYSPACE_E2E_PI_PID: piPidFile,
        BYSPACE_E2E_PI_LAUNCH_COUNT: piLaunchFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  state.daemon = daemon;
  daemon.stdout.on("data", (chunk) => {
    daemonOutput += String(chunk);
  });
  daemon.stderr.on("data", (chunk) => {
    daemonOutput += String(chunk);
  });

  const record = await waitForPidRecord(home, daemon, () => daemonOutput);
  const client = new DaemonClient({
    url: `ws://${record.listen}/ws`,
    clientId: "go_daemon_e2e",
    clientType: "cli",
    reconnect: { enabled: false },
    connectTimeoutMs: 3_000,
  });
  state.client = client;
  await client.connect();

  const workspacePage = await client.fetchWorkspaces();
  expect(workspacePage.entries).toHaveLength(1);
  expect(workspacePage.entries[0]).toMatchObject({
    projectDisplayName: "bspace",
    projectRootPath: canonicalRepositoryRoot,
    workspaceDirectory: canonicalRepositoryRoot,
    projectKind: "directory",
    workspaceKind: "directory",
  });
  const workspaceID = workspacePage.entries[0]!.id;
  const projectID = workspacePage.entries[0]!.projectId;
  const projects = await client.listProjects();
  expect(projects.projects).toEqual([
    expect.objectContaining({
      projectId: projectID,
      projectDisplayName: "bspace",
      projectRootPath: canonicalRepositoryRoot,
      projectKind: "directory",
    }),
  ]);
  const providerSnapshot = await client.getProvidersSnapshot({ cwd: agentCwd });
  expect(providerSnapshot).toMatchObject({
    cwd: agentCwd,
    entries: [
      {
        provider: "pi",
        status: "ready",
        enabled: true,
        source: "builtin",
        models: [],
        modes: [],
        label: "Pi",
      },
    ],
  });
  expect(await client.listProviderModels("pi", agentCwd)).toMatchObject({
    provider: "pi",
    models: [],
  });
  expect(await client.listProviderModes("pi", agentCwd)).toMatchObject({
    provider: "pi",
    modes: [],
  });
  expect(await client.listAvailableProviders()).toMatchObject({
    providers: [{ provider: "pi", available: true }],
  });

  expect((await client.fetchAgents()).entries).toEqual([]);
  await expect(
    client.createAgent({
      provider: "pi",
      cwd: agentCwd,
      images: [{ data: "AA==", mimeType: "image/png" }],
    }),
  ).rejects.toThrow("unsupported");
  await expect(
    client.createAgent({
      provider: "pi",
      cwd: agentCwd,
      outputSchema: { type: "object" },
    }),
  ).rejects.toThrow("unsupported");
  expect((await client.fetchAgents()).entries).toEqual([]);

  const liveTimelineTypes: string[] = [];
  const unsubscribeTimeline = client.subscribeRawMessages((message) => {
    if (message.type === "agent_stream" && message.payload.event.type === "timeline") {
      liveTimelineTypes.push(message.payload.event.item.type);
    }
  });
  const streamed = waitForRawMessage(
    client,
    (message) =>
      message.type === "agent_stream" &&
      message.payload.event.type === "timeline" &&
      message.payload.event.item.type === "assistant_message" &&
      message.payload.event.item.text === "from fake pi",
  );
  const created = await client.createAgent({
    provider: "pi",
    cwd: agentCwd,
    title: "Go daemon E2E",
    labels: { source: "client-e2e" },
    initialPrompt: "stream",
    clientMessageId: "create-message-1",
  });
  await streamed;
  unsubscribeTimeline();
  expect(liveTimelineTypes.slice(0, 2)).toEqual(["user_message", "assistant_message"]);
  expect(created.provider).toBe("pi");
  expect(created.lastUserMessageAt).toEqual(expect.any(String));
  expect(created.labels).toEqual({ source: "client-e2e" });

  const timeline = await waitForTimeline(client, created.id, 2);
  expect(timeline.entries.map((entry) => entry.item.type)).toEqual([
    "user_message",
    "assistant_message",
  ]);
  expect(timeline.entries.map((entry) => entry.seqStart)).toEqual([1, 2]);
  const projectedTimeline = await client.fetchAgentTimeline(created.id, {
    projection: "projected",
  });
  expect(projectedTimeline.entries.map((entry) => entry.item.type)).toEqual([
    "user_message",
    "assistant_message",
  ]);

  await client.sendAgentMessage(created.id, "hold", {
    messageId: "hold-message-2",
  });
  const interruptedStream = waitForRawMessage(
    client,
    (message) =>
      message.type === "agent_stream" &&
      message.payload.event.type === "timeline" &&
      message.payload.event.item.type === "assistant_message" &&
      message.payload.event.item.text === "from fake pi",
  );
  await client.sendAgentMessage(created.id, "stream", {
    messageId: "interrupt-message-3",
  });
  await interruptedStream;

  await client.sendAgentMessage(created.id, "hold", {
    messageId: "hold-message-4",
  });
  const beforeUnsupported = await client.fetchAgentTimeline(created.id, {
    projection: "canonical",
    limit: 0,
  });
  await expect(
    client.sendAgentMessage(created.id, "image", {
      messageId: "image-message-5",
      images: [{ data: "AA==", mimeType: "image/png" }],
    }),
  ).rejects.toThrow("unsupported");
  await expect(
    client.sendAgentMessage(created.id, "steer", {
      messageId: "steer-message-6",
      activeTurnBehavior: "steer",
    }),
  ).rejects.toThrow("unsupported");
  const afterUnsupported = await client.fetchAgentTimeline(created.id, {
    projection: "canonical",
    limit: 0,
  });
  expect(afterUnsupported.entries).toHaveLength(beforeUnsupported.entries.length);
  expect(afterUnsupported.agent?.status).toBe("running");

  await client.cancelAgent(created.id);
  const afterCancel = await client.fetchAgentTimeline(created.id, {
    direction: "tail",
    projection: "canonical",
    limit: 0,
  });
  expect(afterCancel.agent?.status).toBe("idle");

  await client.close();
  state.client = undefined;
  const reconnected = new DaemonClient({
    url: `ws://${record.listen}/ws`,
    clientId: "go_daemon_e2e_reconnect",
    clientType: "cli",
    reconnect: { enabled: false },
    connectTimeoutMs: 3_000,
  });
  state.client = reconnected;
  await reconnected.connect();
  const agents = await reconnected.fetchAgents();
  expect(agents.entries.map((entry) => entry.agent.id)).toContain(created.id);

  await reconnected.sendAgentMessage(created.id, "hold", {
    messageId: "restart-active-message-7",
  });
  const beforeRestart = await reconnected.fetchAgentTimeline(created.id, {
    direction: "tail",
    projection: "canonical",
    limit: 0,
  });
  expect(beforeRestart.agent?.status).toBe("running");
  expect(beforeRestart.entries.at(-1)?.item).toMatchObject({
    type: "user_message",
    text: "hold",
  });
  await execFileAsync(daemonBinary, ["daemon", "stop", "--home", home]);
  await waitForExit(daemon);
  expect(daemon.exitCode).toBe(0);
  const firstPiPid = Number(await readFile(piPidFile, "utf8"));
  expect(isProcessAlive(firstPiPid)).toBe(false);
  await reconnected.close();
  state.client = undefined;
  state.daemon = undefined;

  let restartedOutput = "";
  const restartedDaemon = spawn(
    daemonBinary,
    [
      "daemon",
      "start",
      "--foreground",
      "--home",
      home,
      "--listen",
      "127.0.0.1:0",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        BYSPACE_E2E_PI_PID: piPidFile,
        BYSPACE_E2E_PI_LAUNCH_COUNT: piLaunchFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  state.daemon = restartedDaemon;
  restartedDaemon.stdout.on("data", (chunk) => {
    restartedOutput += String(chunk);
  });
  restartedDaemon.stderr.on("data", (chunk) => {
    restartedOutput += String(chunk);
  });
  const restartedRecord = await waitForPidRecord(
    home,
    restartedDaemon,
    () => restartedOutput,
  );
  const restartedClient = new DaemonClient({
    url: `ws://${restartedRecord.listen}/ws`,
    clientId: "go_daemon_e2e_after_restart",
    clientType: "cli",
    reconnect: { enabled: false },
    connectTimeoutMs: 3_000,
  });
  state.client = restartedClient;
  await restartedClient.connect();

  const restartedWorkspaces = await restartedClient.fetchWorkspaces();
  expect(restartedWorkspaces.entries[0]).toMatchObject({
    id: workspaceID,
    projectId: projectID,
    projectRootPath: canonicalRepositoryRoot,
  });
  const restoredAgents = await restartedClient.fetchAgents();
  const restoredAgent = restoredAgents.entries.find(
    (entry) => entry.agent.id === created.id,
  )?.agent;
  expect(restoredAgent).toMatchObject({
    id: created.id,
    provider: "pi",
    title: "Go daemon E2E",
    labels: { source: "client-e2e" },
    status: "error",
  });
  const restoredTimeline = await restartedClient.fetchAgentTimeline(created.id, {
    direction: "tail",
    projection: "canonical",
    limit: 0,
  });
  expect(restoredTimeline.entries).toEqual(beforeRestart.entries);
  expect(restoredTimeline.epoch).toBe(beforeRestart.epoch);

  await restartedClient.sendAgentMessage(created.id, "must not resend", {
    messageId: "create-message-1",
  });
  const afterDuplicate = await restartedClient.fetchAgentTimeline(created.id, {
    direction: "tail",
    projection: "canonical",
    limit: 0,
  });
  expect(afterDuplicate.entries).toEqual(restoredTimeline.entries);

  const resumedStream = waitForRawMessage(
    restartedClient,
    (message) =>
      message.type === "agent_stream" &&
      message.payload.event.type === "timeline" &&
      message.payload.event.item.type === "assistant_message" &&
      message.payload.event.item.text === "from fake pi",
  );
  await restartedClient.sendAgentMessage(created.id, "stream", {
    messageId: "after-restart-message-8",
  });
  await resumedStream;
  const afterResume = await waitForTimeline(
    restartedClient,
    created.id,
    restoredTimeline.entries.length + 2,
  );
  expect(afterResume.entries.at(-2)?.item).toMatchObject({
    type: "user_message",
    text: "stream",
  });
  expect(afterResume.entries.at(-1)?.item).toMatchObject({
    type: "assistant_message",
    text: "from fake pi",
  });

  await execFileAsync(daemonBinary, ["daemon", "stop", "--home", home]);
  await waitForExit(restartedDaemon);
  expect(restartedDaemon.exitCode).toBe(0);
  const restartedPiPid = Number(await readFile(piPidFile, "utf8"));
  expect(isProcessAlive(restartedPiPid)).toBe(false);
  state.daemon = undefined;
}, 120_000);

async function waitForPidRecord(
  home: string,
  daemon: ChildProcessWithoutNullStreams,
  output: () => string,
): Promise<{ listen: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) {
      throw new Error(
        `Go daemon exited early (${daemon.exitCode}): ${output()}`,
      );
    }
    try {
      return JSON.parse(await readFile(join(home, "byspace.pid"), "utf8")) as {
        listen: string;
      };
    } catch {
      await delay(10);
    }
  }
  throw new Error(`timed out waiting for Go daemon: ${output()}`);
}

function waitForRawMessage(
  client: DaemonClient,
  predicate: (message: SessionOutboundMessage) => boolean,
): Promise<SessionOutboundMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for Go daemon message"));
    }, 3_000);
    const unsubscribe = client.subscribeRawMessages((message) => {
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(message);
    });
  });
}

async function waitForTimeline(
  client: DaemonClient,
  agentId: string,
  size: number,
) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const timeline = await client.fetchAgentTimeline(agentId, {
      direction: "tail",
      projection: "canonical",
      limit: 0,
    });
    if (timeline.entries.length >= size) {
      return timeline;
    }
    await delay(10);
  }
  throw new Error(`timeline did not reach ${size} entries`);
}

function waitForExit(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    process.once("exit", () => resolve());
    process.once("error", reject);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

