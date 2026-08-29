import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createServiceProxySubsystem } from "../service-proxy.js";
import { exportPublicKey, generateKeyPair } from "@bytetrue/byspace-relay/e2ee";
import { RemoteWebServiceManager } from "./remote-web-service-manager.js";
import { RemoteWebServiceStore } from "./remote-web-service-store.js";

const tempDirs: string[] = [];
const logger = pino({ level: "silent" });

async function createPersistedMapping(): Promise<string> {
  const byspaceHome = await fs.mkdtemp(path.join(os.tmpdir(), "byspace-remote-manager-"));
  tempDirs.push(byspaceHome);
  const store = new RemoteWebServiceStore({ byspaceHome, logger });
  await store.create({
    name: "home-web",
    target: {
      serverId: "home-daemon",
      label: "Home Mac",
      port: 5173,
      daemonPublicKeyB64: exportPublicKey(generateKeyPair().publicKey),
    },
  });
  return byspaceHome;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RemoteWebServiceManager", () => {
  it("registers persisted routes only once when initialization is concurrent", async () => {
    const byspaceHome = await createPersistedMapping();
    const manager = new RemoteWebServiceManager({
      byspaceHome,
      serviceProxy: createServiceProxySubsystem({ logger }),
      dataRelay: null,
      daemonKeyPair: generateKeyPair(),
      logger,
    });

    await expect(
      Promise.all([manager.initialize(), manager.initialize(), manager.list()]),
    ).resolves.toBeDefined();
  });
});
