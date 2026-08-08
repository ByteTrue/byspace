import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createTestBySpaceDaemon } from "./test-utils/byspace-daemon.js";

const originalEnv = { ...process.env };
const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

function connectWebSocket(params: {
  port: number;
  protocol?: string;
}): Promise<{ ws: WebSocket; protocol: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${params.port}/ws`,
      params.protocol ? [params.protocol] : undefined,
    );
    ws.once("open", () => resolve({ ws, protocol: ws.protocol }));
    ws.once("error", reject);
  });
}

async function expectWebSocketCloses(params: {
  port: number;
  protocol?: string;
  code: number;
  reason: string;
}): Promise<void> {
  const { ws } = await connectWebSocket(params);
  await expect(
    new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    }),
  ).resolves.toEqual({
    code: params.code,
    reason: params.reason,
  });
}

function waitForWsMessage(
  ws: WebSocket,
  predicate: (message: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message")),
      5000,
    );
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as unknown;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(message);
    };
    ws.on("message", onMessage);
  });
}

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("daemon bearer auth", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...originalEnv, BYSPACE_SUPERVISED: "0" };
  });

  test("leaves HTTP and WebSocket open when no password is configured", async () => {
    const daemonHandle = await createTestBySpaceDaemon();
    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(response.status).toBe(200);

      const { ws, protocol } = await connectWebSocket({ port: daemonHandle.port });
      expect(protocol).toBe("");
      ws.close();
    } finally {
      await daemonHandle.close();
    }
  });

  test("requires Authorization bearer on protected HTTP routes when password is configured", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const missing = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(missing.status).toBe(401);

      const wrong = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`, {
        headers: { Authorization: "Bearer wrong-password" },
      });
      expect(wrong.status).toBe(401);

      const correct = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`, {
        headers: { Authorization: "Bearer correct-password" },
      });
      expect(correct.status).toBe(200);
    } finally {
      await daemonHandle.close();
    }
  });

  test("allows file downloads with only a capability token when password is configured", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      // No bearer at all: the route is reachable, but the download token store
      // rejects the request because no token was supplied (400, not 401).
      const missingToken = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`);
      expect(missingToken.status).toBe(400);

      // An invalid token is rejected by the token store (403, not 401) — proving
      // the token, not the daemon password, is what guards this route.
      const invalidToken = await fetch(
        `http://127.0.0.1:${daemonHandle.port}/api/files/download?token=invalid-token`,
      );
      expect(invalidToken.status).toBe(403);
    } finally {
      await daemonHandle.close();
    }
  });

  test("bypasses bearer auth for preflight and liveness endpoints", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const preflight = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/files/download`, {
        method: "OPTIONS",
        headers: { Origin: "https://byspace.pages.dev" },
      });
      expect(preflight.status).toBe(204);

      const health = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/health`);
      expect(health.status).toBe(200);

      const status = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/status`);
      expect(status.status).toBe(401);
    } finally {
      await daemonHandle.close();
    }
  });

  test("allows daemon-minted terminal CLI tokens only for orchestration messages", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      const tokenPath = join(daemonHandle.byspaceHome, "agent-cli-token.txt");
      await daemonHandle.daemon.terminalManager.createTerminal({
        workspaceId: "auth-test",
        cwd: daemonHandle.byspaceHome,
        command: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(tokenPath)}, process.env.BYSPACE_CLI_TOKEN)`,
        ],
      });
      const token = await waitForFile(tokenPath);
      const { ws } = await connectWebSocket({
        port: daemonHandle.port,
        protocol: `byspace.bearer.${token}`,
      });
      const ready = waitForWsMessage(
        ws,
        (message) => (message as { type?: string }).type === "session",
      );
      ws.send(
        JSON.stringify({
          type: "hello",
          clientId: "agent-cli-auth-test",
          clientType: "cli",
          protocolVersion: 1,
        }),
      );
      await ready;

      const listResponse = waitForWsMessage(
        ws,
        (message) =>
          (message as { type?: string; message?: { type?: string } }).type === "session" &&
          (message as { message?: { type?: string } }).message?.type ===
            "orchestration.tools.list.response",
      );
      ws.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "orchestration.tools.list.request",
            requestId: "list-1",
          },
        }),
      );
      await expect(listResponse).resolves.toMatchObject({
        message: { payload: { requestId: "list-1", success: true } },
      });

      const cliResult = await execFileAsync(
        process.execPath,
        [
          tsxCli,
          "packages/cli/src/index.js",
          "--json",
          "tool",
          "list",
          "--host",
          `127.0.0.1:${daemonHandle.port}`,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, BYSPACE_CLI_TOKEN: token, BYSPACE_PASSWORD: undefined },
        },
      );
      expect(JSON.parse(cliResult.stdout)).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "list_agents" })]),
      );

      const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      });
      ws.send(JSON.stringify({ type: "recording_state", isRecording: false }));
      await expect(closed).resolves.toEqual({
        code: 1008,
        reason: "Agent CLI token only permits orchestration requests",
      });
    } finally {
      await daemonHandle.close();
    }
  }, 15_000);

  test("closes WebSocket connections with readable auth failures when password is configured", async () => {
    const daemonHandle = await createTestBySpaceDaemon({
      auth: { password: CORRECT_PASSWORD_HASH },
    });
    try {
      await expectWebSocketCloses({
        port: daemonHandle.port,
        code: 4401,
        reason: "Password required",
      });
      await expectWebSocketCloses({
        port: daemonHandle.port,
        protocol: "byspace.bearer.wrong-password",
        code: 4401,
        reason: "Incorrect password",
      });

      const { ws, protocol } = await connectWebSocket({
        port: daemonHandle.port,
        protocol: "byspace.bearer.correct-password",
      });
      expect(protocol).toBe("byspace.bearer.correct-password");
      ws.close();
    } finally {
      await daemonHandle.close();
    }
  });
});
