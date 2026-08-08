import type pino from "pino";
import type { KeyPair } from "@bytetrue/byspace-relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";

interface RelaySocketLike {
  readyState: number;
  bufferedAmount?: number;
  send: (data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
  terminate?: () => void;
  on: (event: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  once: (event: "close" | "error", listener: (...args: unknown[]) => void) => void;
}

export interface RelayRuntimeOptions {
  logger: pino.Logger;
  attachSocket: (ws: RelaySocketLike, metadata?: ExternalSocketMetadata) => Promise<void>;
  relayEndpoint: string;
  relayUseTls: boolean;
  serverId: string;
  daemonKeyPair: KeyPair;
  initialEnabled: boolean;
  startTransport?: typeof startRelayTransport;
}

export class RelayRuntime {
  private readonly options: RelayRuntimeOptions;
  private controller: RelayTransportController | null = null;
  private desiredEnabled: boolean;
  private operation: Promise<void> = Promise.resolve();

  constructor(options: RelayRuntimeOptions) {
    this.options = options;
    this.desiredEnabled = options.initialEnabled;
  }

  isEnabled(): boolean {
    return this.desiredEnabled;
  }

  start(): Promise<void> {
    return this.setEnabled(this.desiredEnabled);
  }

  setEnabled(enabled: boolean): Promise<void> {
    this.desiredEnabled = enabled;
    const nextOperation = this.operation.then(() => this.reconcile());
    this.operation = nextOperation.catch(() => undefined);
    return nextOperation;
  }

  stop(): Promise<void> {
    this.desiredEnabled = false;
    const nextOperation = this.operation.then(() => this.reconcile());
    this.operation = nextOperation.catch(() => undefined);
    return nextOperation;
  }

  private async reconcile(): Promise<void> {
    if (!this.desiredEnabled) {
      const controller = this.controller;
      this.controller = null;
      await controller?.stop();
      return;
    }

    if (this.controller) return;

    const startTransport = this.options.startTransport ?? startRelayTransport;
    this.controller = startTransport({
      logger: this.options.logger,
      attachSocket: this.options.attachSocket,
      relayEndpoint: this.options.relayEndpoint,
      relayUseTls: this.options.relayUseTls,
      serverId: this.options.serverId,
      daemonKeyPair: this.options.daemonKeyPair,
    });
  }
}
