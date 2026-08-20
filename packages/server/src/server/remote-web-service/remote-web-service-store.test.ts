import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { exportPublicKey, generateKeyPair } from "@bytetrue/byspace-relay/e2ee";
import { RemoteWebServiceStore } from "./remote-web-service-store.js";

const tempDirs: string[] = [];

async function createStore() {
  const byspaceHome = await fs.mkdtemp(path.join(os.tmpdir(), "byspace-remote-web-service-"));
  tempDirs.push(byspaceHome);
  return {
    byspaceHome,
    store: new RemoteWebServiceStore({ byspaceHome, logger: pino({ level: "silent" }) }),
  };
}

const target = {
  serverId: "home-daemon",
  label: "Home Mac",
  port: 8317,
  daemonPublicKeyB64: exportPublicKey(generateKeyPair().publicKey),
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RemoteWebServiceStore", () => {
  it("persists mappings with stable remote.localhost hostnames", async () => {
    const { byspaceHome, store } = await createStore();
    const created = await store.create({ name: "AI Home", target });

    expect(created.hostname).toBe("ai-home.remote.localhost");
    expect(created.target).toEqual(target);

    const reloaded = new RemoteWebServiceStore({ byspaceHome, logger: pino({ level: "silent" }) });
    await expect(reloaded.list()).resolves.toEqual([created]);
  });

  it("rejects duplicate normalized names and invalid ports", async () => {
    const { store } = await createStore();
    await store.create({ name: "Web Dev", target });

    await expect(store.create({ name: "web-dev", target })).rejects.toThrow("already exists");
    await expect(
      store.create({ name: "bad-port", target: { ...target, port: 0 } }),
    ).rejects.toThrow("port");
  });

  it("deletes a mapping without changing the remaining hostname", async () => {
    const { store } = await createStore();
    const first = await store.create({ name: "first", target });
    const second = await store.create({ name: "second", target });

    await expect(store.remove(first.id)).resolves.toEqual(first);
    await expect(store.list()).resolves.toEqual([second]);
    await expect(store.remove(first.id)).rejects.toThrow("not found");
  });

  it("rejects invalid daemon public keys before persisting", async () => {
    const { store } = await createStore();

    await expect(
      store.create({ name: "invalid-key", target: { ...target, daemonPublicKeyB64: "invalid" } }),
    ).rejects.toThrow();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("refuses to replace an invalid store file", async () => {
    const { byspaceHome } = await createStore();
    const filePath = path.join(byspaceHome, "remote-web-services.json");
    await fs.writeFile(filePath, "not-json", "utf8");
    const store = new RemoteWebServiceStore({ byspaceHome, logger: pino({ level: "silent" }) });

    await expect(store.list()).rejects.toThrow();
    await expect(store.create({ name: "replacement", target })).rejects.toThrow();
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("not-json");
  });

  it.skipIf(process.platform === "win32")(
    "writes private files and keeps memory unchanged when persistence fails",
    async () => {
      const { byspaceHome, store } = await createStore();
      const filePath = path.join(byspaceHome, "remote-web-services.json");
      const created = await store.create({ name: "existing", target });
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);

      await fs.chmod(byspaceHome, 0o500);
      try {
        await expect(store.create({ name: "not-persisted", target })).rejects.toThrow();
        await expect(store.remove(created.id)).rejects.toThrow();
      } finally {
        await fs.chmod(byspaceHome, 0o700);
      }

      await expect(store.list()).resolves.toEqual([created]);
    },
  );
});
