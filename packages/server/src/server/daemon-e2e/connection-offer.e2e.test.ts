import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";

import { generateLocalPairingOffer } from "../pairing-offer.js";
import { createTestBySpaceDaemon } from "../test-utils/byspace-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { loadPersistedConfig } from "../persisted-config.js";

function createCapturingLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString("utf8"));
      cb();
    },
  });
  const logger = pino({ level: "info" }, stream);
  return { logger, lines };
}

async function getPairingOfferUrl(args: {
  byspaceHome: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  appBaseUrl?: string;
}): Promise<string> {
  const pairing = await generateLocalPairingOffer({
    byspaceHome: args.byspaceHome,
    relayEnabled: args.relayEnabled,
    relayEndpoint: args.relayEndpoint,
    relayPublicEndpoint: args.relayPublicEndpoint,
    appBaseUrl: args.appBaseUrl,
    includeQr: false,
  });
  if (!pairing.url) {
    throw new Error("Expected relay pairing URL to be available");
  }
  return pairing.url;
}

function decodeOfferFromFragmentUrl(url: string): unknown {
  const marker = "#offer=";
  const idx = url.indexOf(marker);
  if (idx === -1) {
    throw new Error(`missing ${marker} fragment: ${url}`);
  }
  const encoded = url.slice(idx + marker.length);
  const json = Buffer.from(encoded, "base64url").toString("utf8");
  return JSON.parse(json) as unknown;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

describe("ConnectionOfferV2 (daemon E2E)", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("emits relay-only offer URL with stable serverId", async () => {
    process.env.BYSPACE_PRIMARY_LAN_IP = "192.168.1.12";

    const { logger } = createCapturingLogger();

    const daemon = await createTestBySpaceDaemon({
      listen: "0.0.0.0",
      logger,
      relayEnabled: true,
    });

    try {
      const offerUrl = await getPairingOfferUrl({
        byspaceHome: daemon.byspaceHome,
        relayEnabled: daemon.config.relayEnabled,
        relayEndpoint: daemon.config.relayEndpoint,
        relayPublicEndpoint: daemon.config.relayPublicEndpoint,
        appBaseUrl: daemon.config.appBaseUrl,
      });
      expect(offerUrl.startsWith("https://app.byspace.zijieapi.de5.net/#offer=")).toBe(true);

      const offer = decodeOfferFromFragmentUrl(offerUrl) as {
        v: number;
        serverId: string;
        daemonPublicKeyB64: string;
        relay: { endpoint: string };
      };

      expect(offer.v).toBe(2);
      expect(typeof offer.serverId).toBe("string");
      expect(offer.serverId.length).toBeGreaterThan(0);
      expect(offer.serverId.startsWith("srv_")).toBe(true);
      expect(offer.relay.endpoint).toBe("relay.byspace.zijieapi.de5.net:443");
      expect(typeof offer.daemonPublicKeyB64).toBe("string");
      expect(offer.daemonPublicKeyB64.length).toBeGreaterThan(0);
      expect(() => Buffer.from(offer.daemonPublicKeyB64, "base64")).not.toThrow();

      expect("endpoints" in offer).toBe(false);
    } finally {
      await daemon.close();
    }
  });

  test("persists serverId and daemon keypair across daemon restarts", async () => {
    process.env.BYSPACE_PRIMARY_LAN_IP = "192.168.1.12";

    const tempHomeRoot = await mkdtemp(path.join(os.tmpdir(), "byspace-offer-home-"));

    const { logger: logger1 } = createCapturingLogger();
    const daemon1 = await createTestBySpaceDaemon({
      listen: "0.0.0.0",
      logger: logger1,
      relayEnabled: true,
      byspaceHomeRoot: tempHomeRoot,
      cleanup: false,
    });

    let staticDir1: string | null = daemon1.staticDir;
    let staticDir2: string | null = null;

    try {
      const offerUrl1 = await getPairingOfferUrl({
        byspaceHome: daemon1.byspaceHome,
        relayEnabled: daemon1.config.relayEnabled,
        relayEndpoint: daemon1.config.relayEndpoint,
        relayPublicEndpoint: daemon1.config.relayPublicEndpoint,
        appBaseUrl: daemon1.config.appBaseUrl,
      });
      const offer1 = decodeOfferFromFragmentUrl(offerUrl1) as {
        serverId: string;
        daemonPublicKeyB64: string;
        relay: { endpoint: string };
      };

      await daemon1.close();

      const { logger: logger2 } = createCapturingLogger();
      const daemon2 = await createTestBySpaceDaemon({
        listen: "0.0.0.0",
        logger: logger2,
        relayEnabled: true,
        byspaceHomeRoot: tempHomeRoot,
        cleanup: false,
      });
      staticDir2 = daemon2.staticDir;

      try {
        const offerUrl2 = await getPairingOfferUrl({
          byspaceHome: daemon2.byspaceHome,
          relayEnabled: daemon2.config.relayEnabled,
          relayEndpoint: daemon2.config.relayEndpoint,
          relayPublicEndpoint: daemon2.config.relayPublicEndpoint,
          appBaseUrl: daemon2.config.appBaseUrl,
        });
        const offer2 = decodeOfferFromFragmentUrl(offerUrl2) as {
          serverId: string;
          daemonPublicKeyB64: string;
          relay: { endpoint: string };
        };

        expect(offer2.serverId).toBe(offer1.serverId);
        expect(offer2.daemonPublicKeyB64).toBe(offer1.daemonPublicKeyB64);
        expect(offer2.relay.endpoint).toBe(offer1.relay.endpoint);
      } finally {
        await daemon2.close();
      }
    } finally {
      await rm(tempHomeRoot, { recursive: true, force: true });
      if (staticDir1) {
        await rm(staticDir1, { recursive: true, force: true });
        staticDir1 = null;
      }
      if (staticDir2) {
        await rm(staticDir2, { recursive: true, force: true });
        staticDir2 = null;
      }
    }
  });

  test.each([
    { flag: "--relay", expected: true },
    { flag: "--no-relay", expected: false },
  ])(
    "worker consumes $flag as an immutable launch override",
    async ({ flag, expected }) => {
      process.env.BYSPACE_PRIMARY_LAN_IP = "192.168.1.12";

      const tempHome = await mkdtemp(path.join(os.tmpdir(), "byspace-offer-e2e-"));
      const port = await getAvailablePort();
      const serverRoot = path.resolve(import.meta.dirname, "../../..");
      const supervisorPath = path.join(serverRoot, "scripts/supervisor-entrypoint.ts");
      const tsxBin = path.resolve(serverRoot, "../../node_modules/.bin/tsx");
      const env = {
        ...process.env,
        BYSPACE_HOME: tempHome,
        BYSPACE_LISTEN: `127.0.0.1:${port}`,
        BYSPACE_RELAY_ENDPOINT: "127.0.0.1:9",
        BYSPACE_RELAY_USE_TLS: "false",
        OPENAI_API_KEY: "",
        BYSPACE_DICTATION_ENABLED: "0",
        BYSPACE_VOICE_MODE_ENABLED: "0",
        BYSPACE_LOG_FORMAT: "json",
      };
      const stdoutLines: string[] = [];
      const proc = spawn(tsxBin, [supervisorPath, "--dev", flag], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let client: DaemonClient | null = null;

      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("timed out waiting for server listening log"));
          }, 15000);
          const onData = (data: Buffer) => {
            const text = data.toString("utf8");
            stdoutLines.push(text);
            for (const line of text.split("\n")) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line) as { msg?: string };
                if (parsed.msg !== `Server listening on http://127.0.0.1:${port}`) continue;
                clearTimeout(timeout);
                resolve();
                return;
              } catch {
                // Ignore non-JSON development output.
              }
            }
          };

          proc.stdout?.on("data", onData);
          proc.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          proc.on("exit", (code) => {
            if (code !== null && code !== 0) {
              clearTimeout(timeout);
              reject(new Error(`daemon process exited early with code ${code}`));
            }
          });
        });

        client = new DaemonClient({
          url: `ws://127.0.0.1:${port}/ws`,
          appVersion: "0.1.82",
        });
        await client.connect();

        expect((await client.getDaemonStatus()).relay?.enabled).toBe(expected);
        expect((await client.getDaemonConfig()).config.relay?.enabled).toBe(expected);
        await expect(client.patchDaemonConfig({ relay: { enabled: !expected } })).rejects.toThrow(
          "Relay is controlled by a daemon launch override",
        );
        expect((await client.getDaemonStatus()).relay?.enabled).toBe(expected);
        expect((await client.getDaemonConfig()).config.relay?.enabled).toBe(expected);
        expect(loadPersistedConfig(tempHome).daemon?.relay?.enabled).toBe(false);
      } catch (error) {
        throw new Error(`failed; stdout so far:\n${stdoutLines.join("")}\n\n${String(error)}`, {
          cause: error,
        });
      } finally {
        await client?.close().catch(() => undefined);
        proc.kill();
        await rm(tempHome, { recursive: true, force: true });
      }
    },
    30000,
  );
});
