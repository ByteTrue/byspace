import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";

import { TunnelRegistryService } from "./tunnel-registry.js";

const logger = pino({ level: "silent" });

let homeRoot: string;
let byspaceHome: string;

beforeEach(async () => {
  homeRoot = await mkdtemp(path.join(os.tmpdir(), "tunnel-registry-"));
  byspaceHome = path.join(homeRoot, ".byspace");
  await mkdir(byspaceHome, { recursive: true });
});

afterEach(async () => {
  await rm(homeRoot, { recursive: true, force: true });
});

const peerConfig = {
  peerId: "srv_peer",
  url: "ws://127.0.0.1:6777/ws?serverId=srv_peer&role=client&v=2",
  password: "pw",
  forwards: [{ remotePort: 3000, label: "dev" }],
};

// The registry starts real TunnelManagers that dial the peer URL; use an
// unreachable local port and rely on the manager's fire-and-forget connect
// (listener startup does not depend on the peer being reachable).
const unreachablePeerConfig = {
  ...peerConfig,
  url: "ws://127.0.0.1:1/ws?serverId=srv_x&role=client&v=2",
};

describe("TunnelRegistryService", () => {
  const enabled = () =>
    new TunnelRegistryService({ byspaceHome, logger, isInitiallyEnabled: () => true });

  it("starts empty and lists nothing", () => {
    const registry = new TunnelRegistryService({ byspaceHome, logger });
    expect(registry.list()).toEqual([]);
  });

  it("persists added peers to tunnels.json and reloads them on a fresh instance", async () => {
    const registry = enabled();
    await registry.add(unreachablePeerConfig);
    await registry.stop();

    const raw = JSON.parse(await readFile(path.join(byspaceHome, "tunnels.json"), "utf8"));
    expect(raw.peers).toHaveLength(1);
    expect(raw.peers[0].peerId).toBe(unreachablePeerConfig.peerId);
    expect(raw.peers[0].password).toBe("pw");

    const reopened = enabled();
    await reopened.start();
    const listed = reopened.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].peerId).toBe(unreachablePeerConfig.peerId);
    await reopened.stop();
  });

  it("rejects duplicate peer adds", async () => {
    const registry = enabled();
    await registry.add(unreachablePeerConfig);
    await expect(registry.add(unreachablePeerConfig)).rejects.toThrow(/already exists/);
    await registry.stop();
  });

  it("remove persists the removal and is idempotent for unknown peers", async () => {
    const registry = enabled();
    await registry.add(unreachablePeerConfig);
    await registry.remove(unreachablePeerConfig.peerId);
    expect(registry.list()).toEqual([]);

    const raw = JSON.parse(await readFile(path.join(byspaceHome, "tunnels.json"), "utf8"));
    expect(raw.peers).toHaveLength(0);

    await expect(registry.remove("srv_unknown")).resolves.toBeUndefined();
    await registry.stop();
  });

  it("skips corrupt tunnels.json and starts empty", async () => {
    await writeFile(path.join(byspaceHome, "tunnels.json"), "{not json", "utf8");
    const registry = new TunnelRegistryService({ byspaceHome, logger });
    expect(registry.list()).toEqual([]);
    await registry.stop();
  });

  it("rejects add and skips boot start while disabled (experimental gate)", async () => {
    const registry = new TunnelRegistryService({ byspaceHome, logger });
    await expect(registry.add(unreachablePeerConfig)).rejects.toThrow(/disabled/);
    await registry.start();
    expect(registry.list()).toEqual([]);

    // Persist a peer out-of-band; a disabled boot still starts nothing.
    await writeFile(
      path.join(byspaceHome, "tunnels.json"),
      JSON.stringify({ v: 1, peers: [unreachablePeerConfig] }),
      "utf8",
    );
    const disabled = new TunnelRegistryService({ byspaceHome, logger });
    await disabled.start();
    expect(disabled.list()).toEqual([]);
    await disabled.stop();
    await registry.stop();
  });

  it("setEnabled(true) hot-starts persisted peers", async () => {
    await writeFile(
      path.join(byspaceHome, "tunnels.json"),
      JSON.stringify({ v: 1, peers: [unreachablePeerConfig] }),
      "utf8",
    );
    const registry = new TunnelRegistryService({ byspaceHome, logger });
    await registry.start();
    expect(registry.list()).toEqual([]);

    registry.setEnabled(true);
    await vi.waitFor(() => {
      expect(registry.list()).toHaveLength(1);
    });
    expect(registry.list()[0].peerId).toBe(unreachablePeerConfig.peerId);

    registry.setEnabled(false);
    await vi.waitFor(() => {
      expect(registry.list()).toEqual([]);
    });
    await registry.stop();
  });
});
