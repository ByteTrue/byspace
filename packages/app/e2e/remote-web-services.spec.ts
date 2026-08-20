import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import { openSettingsHost, seedSavedSettingsHosts, selectSettingsHost } from "./helpers/settings";
const DATA_RELAY_ACCESS_TOKEN = "playwright-remote-web-services-token";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SERVER_DIR = path.join(REPO_ROOT, "packages/server");
const resolveFromRoot = createRequire(path.join(REPO_ROOT, "package.json"));
const TSX_CLI = resolveFromRoot.resolve("tsx/cli");

interface E2EDaemon {
  child: ChildProcess;
  home: string;
  port: number;
  serverId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDaemonHealthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path: "/health", method: "GET", agent: false },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.setTimeout(1_000, () => request.destroy());
    request.once("error", () => resolve(false));
    request.end();
  });
}

function fetchRemoteProbe(port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/probe",
        method: "GET",
        headers: { host: "home-web.remote.localhost" },
        agent: false,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.setTimeout(1_000, () => request.destroy());
    request.once("error", () => resolve(undefined));
    request.end();
  });
}

async function waitForDaemon(port: number, child: ChildProcess, output: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test daemon exited with code ${child.exitCode}\n${output.join("")}`);
    }
    if (await isDaemonHealthy(port)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for test daemon on ${port}\n${output.join("")}`);
}

interface StartDaemonInput {
  corsOrigin: string;
  dataRelayEndpoint: string;
  dataRelayListen?: string;
  home?: string;
  port?: number;
}

async function startDaemon(input: StartDaemonInput): Promise<E2EDaemon> {
  const home = input.home ?? (await mkdtemp(path.join(os.tmpdir(), "byspace-rws-playwright-")));
  const port = input.port ?? (await getAvailablePort());
  const output: string[] = [];
  const child = spawn(process.execPath, [TSX_CLI, "scripts/supervisor-entrypoint.ts", "--dev"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      BYSPACE_HOME: home,
      BYSPACE_ORCHESTRATION_SKILLS_HOME: home,
      BYSPACE_LISTEN: `127.0.0.1:${port}`,
      BYSPACE_RELAY_ENABLED: "0",
      BYSPACE_CORS_ORIGINS: input.corsOrigin,
      BYSPACE_DATA_RELAY_ENDPOINT: input.dataRelayEndpoint,
      BYSPACE_DATA_RELAY_USE_TLS: "false",
      BYSPACE_DATA_RELAY_ACCESS_TOKEN: DATA_RELAY_ACCESS_TOKEN,
      BYSPACE_DATA_RELAY_LISTEN: input.dataRelayListen,
      BYSPACE_DICTATION_ENABLED: "0",
      BYSPACE_VOICE_MODE_ENABLED: "0",
      BYSPACE_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
      BYSPACE_NODE_ENV: "development",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  try {
    await waitForDaemon(port, child, output);
    return {
      child,
      home,
      port,
      serverId: (await readFile(path.join(home, "server-id"), "utf8")).trim(),
    };
  } catch (error) {
    child.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

async function stopDaemonProcess(daemon: E2EDaemon): Promise<void> {
  if (daemon.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => daemon.child.once("exit", () => resolve()));
  daemon.child.kill("SIGTERM");
  await Promise.race([exited, sleep(10_000)]);
  if (daemon.child.exitCode === null) daemon.child.kill("SIGKILL");
}

async function stopDaemon(daemon: E2EDaemon | null): Promise<void> {
  if (!daemon) return;
  await stopDaemonProcess(daemon);
  await rm(daemon.home, { recursive: true, force: true });
}

async function restartDaemon(daemon: E2EDaemon, input: StartDaemonInput): Promise<E2EDaemon> {
  await stopDaemonProcess(daemon);
  return startDaemon({ ...input, home: daemon.home, port: daemon.port });
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a local port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function startTargetService(): Promise<{ port: number; server: Server }> {
  const server = createServer((request, response) => {
    if (request.url !== "/probe") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><main>Remote target reached</main>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Remote Web Service fixture did not bind a TCP port");
  }
  return { port: address.port, server };
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readRemoteWebServiceStore(home: string): Promise<{
  services: Array<{ id: string }>;
  grants: Array<{ serviceId: string; sourceDaemonPublicKeyB64: string; targetPort: number }>;
}> {
  return JSON.parse(await readFile(path.join(home, "remote-web-services.json"), "utf8"));
}

test.describe("Remote Web Services", () => {
  let source: E2EDaemon | null = null;
  let target: E2EDaemon | null = null;
  let targetService: Server | null = null;
  let targetPort = 0;
  let sourceServerId = "";
  let targetServerId = "";
  let corsOrigin = "";
  let dataRelayEndpoint = "";

  test.beforeAll(async () => {
    const metroPort = process.env.E2E_METRO_PORT;
    if (!metroPort) throw new Error("E2E_METRO_PORT is not set");
    corsOrigin = `http://localhost:${metroPort}`;
    const dataRelayPort = await getAvailablePort();
    dataRelayEndpoint = `127.0.0.1:${dataRelayPort}`;
    const fixture = await startTargetService();
    targetService = fixture.server;
    targetPort = fixture.port;

    source = await startDaemon({
      corsOrigin,
      dataRelayListen: dataRelayEndpoint,
      dataRelayEndpoint,
    });
    target = await startDaemon({ corsOrigin, dataRelayEndpoint });
    sourceServerId = source.serverId;
    targetServerId = target.serverId;
  });

  test.afterAll(async () => {
    await stopDaemon(target);
    await stopDaemon(source);
    await closeServer(targetService);
  });

  test("creates, reaches, persists, and removes a mapping on desktop and compact layouts", async ({
    page,
  }, testInfo) => {
    if (!source || !target) throw new Error("Remote Web Service daemons are not running");
    const targetHome = target.home;
    await seedSavedSettingsHosts(page, [
      {
        serverId: sourceServerId,
        label: "Source host",
        endpoint: `127.0.0.1:${source.port}`,
      },
      {
        serverId: targetServerId,
        label: "Target host",
        endpoint: `127.0.0.1:${target.port}`,
      },
    ]);
    await gotoAppShell(page);
    await openSettings(page);
    await selectSettingsHost(page, sourceServerId);
    await openSettingsHost(page, sourceServerId);

    const addButton = page.getByTestId("remote-web-service-add");
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await page.getByTestId("remote-web-service-name-input").fill("home-web");
    await page.getByTestId("remote-web-service-target-trigger").click();
    await page.getByTestId(`remote-web-service-target-option-${targetServerId}`).click();
    await page.getByTestId("remote-web-service-port-input").fill(String(targetPort));
    await page.getByTestId("remote-web-service-create").click();

    const row = page.getByTestId(/^remote-web-service-row-/);
    await expect(row).toContainText("home-web.remote.localhost");
    await expect(row).toContainText(`Target host · localhost:${targetPort}`);

    const sourceStore = await readRemoteWebServiceStore(source.home);
    const sourceKey = JSON.parse(
      await readFile(path.join(source.home, "daemon-keypair.json"), "utf8"),
    ) as { publicKeyB64: string };
    await expect
      .poll(() => readRemoteWebServiceStore(targetHome))
      .toMatchObject({
        grants: [
          {
            serviceId: sourceStore.services[0]?.id,
            sourceDaemonPublicKeyB64: sourceKey.publicKeyB64,
            targetPort,
          },
        ],
      });

    const desktopScreenshot = testInfo.outputPath("remote-web-services-desktop.png");
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    await testInfo.attach("Remote Web Services — desktop", {
      path: desktopScreenshot,
      contentType: "image/png",
    });

    const localUrl = `http://home-web.remote.localhost:${source.port}/probe`;
    const probePage = await page.context().newPage();
    await probePage.goto(localUrl);
    await expect(probePage.getByText("Remote target reached", { exact: true })).toBeVisible();
    await probePage.close();

    source = await restartDaemon(source, {
      corsOrigin,
      dataRelayListen: dataRelayEndpoint,
      dataRelayEndpoint,
    });
    await expect.poll(() => fetchRemoteProbe(source?.port ?? 0), { timeout: 15_000 }).toBe(200);
    await expect(page.getByTestId(/^remote-web-service-row-/)).toContainText(
      "home-web.remote.localhost",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId(/^remote-web-service-row-/)).toContainText(
      "home-web.remote.localhost",
    );

    const compactScreenshot = testInfo.outputPath("remote-web-services-compact.png");
    await page.screenshot({ path: compactScreenshot, fullPage: true });
    await testInfo.attach("Remote Web Services — compact", {
      path: compactScreenshot,
      contentType: "image/png",
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId(/^remote-web-service-remove-/).click();
    await expect(page.getByTestId(/^remote-web-service-row-/)).toHaveCount(0);
    await expect.poll(() => readRemoteWebServiceStore(targetHome)).toMatchObject({ grants: [] });
  });
});
