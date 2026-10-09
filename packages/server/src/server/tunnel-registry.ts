import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type pino from "pino";

import { writePrivateFileAtomicSync } from "./private-files.js";
import { TunnelManager } from "./tunnel-manager.js";
import type { OutboundTunnelStatus } from "./session/tunnel/tunnel-session.js";

/**
 * Daemon-level registry of outbound tunnels (D1 side). Owns one
 * TunnelManager per configured peer daemon, persists the peer configs to
 * $BYSPACE_HOME/tunnels.json, and starts/stops managers at daemon lifecycle.
 * Runs with or without app clients connected — tunnels are daemon-level
 * features (issue 062), like the relay transport.
 */

const TunnelRegistrySchema = z.object({
  v: z.literal(1),
  peers: z.array(
    z.object({
      peerId: z.string().min(1),
      peerHostname: z.string().optional(),
      url: z.string().min(1),
      password: z.string().min(1),
      daemonPublicKeyB64: z.string().optional(),
      forwards: z
        .array(
          z.object({
            remotePort: z.number().int().min(1).max(65535),
            label: z.string().optional(),
          }),
        )
        .min(1),
    }),
  ),
});

type TunnelRegistry = z.infer<typeof TunnelRegistrySchema>;

const TUNNELS_FILENAME = "tunnels.json";

function loadRegistry(byspaceHome: string, logger: pino.Logger): TunnelRegistry {
  const filePath = path.join(byspaceHome, TUNNELS_FILENAME);
  if (!existsSync(filePath)) return { v: 1, peers: [] };
  try {
    return TunnelRegistrySchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    logger.warn({ err: error, filePath }, "Failed to load tunnels.json; starting empty");
    return { v: 1, peers: [] };
  }
}

export class TunnelRegistryService {
  private readonly byspaceHome: string;
  private readonly logger: pino.Logger;
  private registry: TunnelRegistry;
  private managers = new Map<string, TunnelManager>();
  private stopped = false;
  /** Experimental gate (issue 063): tunnels stay off until the user opts in. */
  private enabled: boolean;

  constructor(options: {
    byspaceHome: string;
    logger: pino.Logger;
    /** Read once at boot; hot changes arrive through setEnabled. */
    isInitiallyEnabled?: () => boolean;
  }) {
    this.byspaceHome = options.byspaceHome;
    this.logger = options.logger.child({ module: "tunnel-registry" });
    this.registry = loadRegistry(options.byspaceHome, this.logger);
    this.enabled = options.isInitiallyEnabled?.() ?? false;
  }

  /**
   * Hot-switch the experimental gate. Enabling starts every persisted peer
   * that is not running; disabling stops all managers. Wired through
   * onFieldChange("tunnel.enabled"), mirroring relayRuntime.setEnabled.
   */
  setEnabled(value: boolean): void {
    if (this.stopped || this.enabled === value) return;
    this.enabled = value;
    this.logger.info({ enabled: value }, "Tunnel registry gate changed");
    if (!value) {
      for (const [peerId, manager] of this.managers) {
        void manager
          .stop()
          .catch((error: unknown) => {
            this.logger.warn({ err: error, peerId }, "Failed to stop tunnel manager");
          })
          .finally(() => this.managers.delete(peerId));
      }
      return;
    }
    for (const peer of this.registry.peers) {
      if (this.managers.has(peer.peerId)) continue;
      void this.startManager(peer).catch((error: unknown) => {
        this.logger.warn(
          { err: error, peerId: peer.peerId },
          "Failed to start tunnel manager after enable",
        );
      });
    }
  }

  /** Start all configured peers at daemon boot (only when enabled). */
  async start(): Promise<void> {
    this.logger.info(
      { peers: this.registry.peers.length, enabled: this.enabled },
      "Tunnel registry starting",
    );
    if (!this.enabled) return;
    for (const peer of this.registry.peers) {
      await this.startManager(peer).catch((error: unknown) => {
        this.logger.warn(
          { err: error, peerId: peer.peerId },
          "Failed to start tunnel manager at boot",
        );
      });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const [peerId, manager] of this.managers) {
      await manager.stop().catch((error: unknown) => {
        this.logger.warn({ err: error, peerId }, "Failed to stop tunnel manager");
      });
    }
    this.managers.clear();
  }

  list(): OutboundTunnelStatus[] {
    return [...this.managers.values()].map((manager) => {
      const peer = this.registry.peers.find((p) => p.peerId === manager.peerId);
      const forwards = manager.getStatus();
      return {
        peerId: manager.peerId,
        peerHostname: peer?.peerHostname ?? null,
        state: aggregateState(forwards),
        lastError: forwards.find((f) => f.lastError)?.lastError ?? null,
        forwards,
      };
    });
  }

  async add(config: {
    peerId: string;
    peerHostname?: string;
    url: string;
    password: string;
    daemonPublicKeyB64?: string;
    forwards: Array<{ remotePort: number; label?: string }>;
  }): Promise<void> {
    if (!this.enabled) {
      throw new Error("Daemon tunnels are disabled. Enable them in the Tunnels page first.");
    }
    if (this.managers.has(config.peerId)) {
      throw new Error(`A tunnel to peer ${config.peerId} already exists`);
    }
    const next: TunnelRegistry = {
      v: 1,
      peers: [...this.registry.peers.filter((p) => p.peerId !== config.peerId), config],
    };
    this.persist(next);
    if (this.stopped) return;
    await this.startManager(config);
  }

  async remove(peerId: string): Promise<void> {
    const manager = this.managers.get(peerId);
    if (manager) {
      await manager.stop().catch(() => undefined);
      this.managers.delete(peerId);
    }
    const next: TunnelRegistry = {
      v: 1,
      peers: this.registry.peers.filter((p) => p.peerId !== peerId),
    };
    if (next.peers.length === 0 && this.registry.peers.length === 0) {
      // Removing an unknown peer is idempotent (no error).
      return;
    }
    this.persist(next);
  }

  private persist(next: TunnelRegistry): void {
    this.registry = next;
    writePrivateFileAtomicSync(
      path.join(this.byspaceHome, TUNNELS_FILENAME),
      JSON.stringify(next, null, 2) + "\n",
    );
  }

  private async startManager(peer: TunnelRegistry["peers"][number]): Promise<void> {
    const manager = new TunnelManager({
      config: peer,
      logger: this.logger,
    });
    this.managers.set(peer.peerId, manager);
    await manager.start();
  }
}

function aggregateState(forwards: OutboundTunnelStatus["forwards"]): OutboundTunnelStatus["state"] {
  if (forwards.length === 0) return "disconnected";
  if (forwards.some((f) => f.state === "error")) return "error";
  if (forwards.every((f) => f.state === "connected")) return "connected";
  return "connecting";
}
