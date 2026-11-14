#!/usr/bin/env node
// Pairs a fresh browser with a throwaway daemon through the deployed web app and relay.
//
// Every pairing test in web/e2e runs against the relay built from this checkout. The path a user
// takes also includes Cloudflare's Worker serving the web bundle and the relay route, and a broken
// handshake there has reached a release before. The daemon is real, the relay is the deployed one,
// and the browser starts with no storage, which is what a phone does after scanning the pairing
// code.
//
// Run with DEPLOY_WEB_ORIGIN=https://app.byspace.cc.cd (the beta workflow passes its own origin).

import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

// Throwaway: the temp home is deleted, and the password only guards a daemon that lives for this
// run. Keeping it fixed makes the log easy to read when the step fails.
const PASSWORD = "deploy-pairing-smoke";
const origin = (process.env.DEPLOY_WEB_ORIGIN ?? "").trim().replace(/\/+$/, "");
if (!origin) throw new Error("DEPLOY_WEB_ORIGIN is required");
const relayHost = new URL(origin).host;
const repoRoot = path.resolve(import.meta.dirname, "..");
const binary = path.join(repoRoot, "bin", "byspace");
const keepHome = process.env.DEPLOY_SMOKE_KEEP_HOME === "1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (port === 0) throw new Error("Could not allocate a port for the smoke daemon");
  return port;
}

async function waitForPort(port, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Smoke daemon exited before listening (code ${String(child.exitCode)}, signal ${String(child.signalCode)})`,
      );
    }
    const reachable = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve(true);
      });
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => resolve(false));
    });
    if (reachable) return;
    await sleep(100);
  }
  throw new Error(`Smoke daemon did not listen on 127.0.0.1:${port}`);
}

async function waitForRelay(env) {
  const deadline = Date.now() + 60_000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    try {
      lastStatus = execFileSync(binary, ["daemon", "status"], {
        env,
        encoding: "utf8",
        timeout: 20_000,
      });
    } catch (error) {
      lastStatus = `${error.stdout ?? ""}${error.stderr ?? ""}` || String(error);
    }
    const relayLine = lastStatus
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.startsWith("relay"));
    if (
      relayLine &&
      !relayLine.includes("not connected") &&
      !relayLine.includes("disabled") &&
      !relayLine.includes("no endpoint")
    ) {
      return relayLine;
    }
    await sleep(500);
  }
  throw new Error(`Relay did not connect within 60s. Last daemon status:\n${lastStatus}`);
}

async function tailFile(file) {
  try {
    const text = await readFile(file, "utf8");
    return text.split(/\r?\n/u).slice(-60).join("\n");
  } catch {
    return "";
  }
}

function pairingUrlFromOutput(output) {
  const url = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.includes("#offer="));
  if (!url) throw new Error(`\`byspace pair\` printed no offer URL:\n${output}`);
  return url;
}

const home = await mkdtemp(path.join(tmpdir(), "byspace-deploy-pairing-"));
const port = await freePort();
const address = `127.0.0.1:${port}`;
const env = { ...process.env, BYSPACE_HOME: home, BYSPACE_LISTEN: address };
let child = null;
let browser = null;
let daemonLog = "";

try {
  await writeFile(
    path.join(home, "config.json"),
    `${JSON.stringify({
      version: 1,
      appBaseUrl: origin,
      daemon: {
        relay: {
          enabled: true,
          endpoint: relayHost,
          publicEndpoint: relayHost,
          useTls: true,
          publicUseTls: true,
        },
      },
    })}\n`,
  );

  child = spawn(binary, ["serve"], {
    cwd: repoRoot,
    env: {
      ...env,
      BYSPACE_SERVER_ID: "deploy-pairing-smoke",
      BYSPACE_DISABLE_HOME_WORKSPACE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    daemonLog += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    daemonLog += chunk.toString("utf8");
  });
  await waitForPort(port, child);

  execFileSync(binary, ["daemon", "set-password"], {
    env,
    input: `${PASSWORD}\n${PASSWORD}\n`,
    encoding: "utf8",
  });
  console.log(await waitForRelay(env));

  const offerUrl = pairingUrlFromOutput(
    execFileSync(binary, ["pair", "--home", home, "--no-qr"], { env, encoding: "utf8" }),
  );
  const offeredOrigin = new URL(offerUrl).origin;
  if (offeredOrigin !== origin) {
    throw new Error(`Offer points at ${offeredOrigin}, expected ${origin}`);
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  try {
    await page.goto(offerUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("pair-link-modal").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("pair-link-daemon-password-input").fill(PASSWORD);
    await page.getByTestId("pair-link-submit").click();
    await page.getByTestId("sidebar-settings").waitFor({ state: "visible", timeout: 60_000 });
    console.log(`paired with ${origin} through ${relayHost}`);
  } catch (error) {
    console.error(`pairing failed at ${page.url()}`);
    if (consoleErrors.length > 0) console.error(`browser errors:\n${consoleErrors.join("\n")}`);
    throw error;
  }
} catch (error) {
  const log = await tailFile(path.join(home, "daemon.log"));
  if (log) console.error(`daemon log:\n${log}`);
  if (daemonLog.trim()) console.error(`daemon output:\n${daemonLog.trim()}`);
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(5_000).then(() => child.kill("SIGKILL")),
    ]);
  }
  if (!keepHome) await rm(home, { recursive: true, force: true });
}
