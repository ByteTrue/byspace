import type pino from "pino";
import type { KeyPair } from "@bytetrue/byspace-relay/e2ee";
import type { ServiceProxySubsystem } from "../service-proxy.js";
import { connectRemoteWebService, type DataRelayClientConfig } from "./data-relay.js";
import {
  RemoteWebServiceStore,
  type RemoteWebService,
  type RemoteWebServiceTarget,
} from "./remote-web-service-store.js";

export class RemoteWebServiceManager {
  private readonly store: RemoteWebServiceStore;
  private initialization: Promise<void> | null = null;

  constructor(options: {
    byspaceHome: string;
    serviceProxy: ServiceProxySubsystem;
    dataRelay: DataRelayClientConfig | null;
    daemonKeyPair: KeyPair;
    logger: pino.Logger;
  }) {
    this.store = new RemoteWebServiceStore({
      byspaceHome: options.byspaceHome,
      logger: options.logger,
    });
    this.serviceProxy = options.serviceProxy;
    this.dataRelay = options.dataRelay;
    this.daemonKeyPair = options.daemonKeyPair;
    this.logger = options.logger.child({ component: "remote-web-service-manager" });
  }

  private readonly serviceProxy: ServiceProxySubsystem;
  private readonly dataRelay: DataRelayClientConfig | null;
  private readonly daemonKeyPair: KeyPair;
  private readonly logger: pino.Logger;

  isDataRelayConfigured(): boolean {
    return this.dataRelay !== null;
  }

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    const services = await this.store.list();
    for (const service of services) this.registerRoute(service);
  }

  async list(): Promise<RemoteWebService[]> {
    await this.initialize();
    return this.store.list();
  }

  async create(input: { name: string; target: RemoteWebServiceTarget }): Promise<RemoteWebService> {
    await this.initialize();
    const service = await this.store.create(input);
    try {
      this.registerRoute(service);
      return service;
    } catch (error) {
      await this.store.remove(service.id).catch(() => undefined);
      throw error;
    }
  }

  async remove(id: string): Promise<RemoteWebService> {
    await this.initialize();
    const service = await this.store.remove(id);
    this.serviceProxy.removeRemoteWebService(service.hostname);
    return service;
  }

  grant(input: {
    serviceId: string;
    sourceDaemonPublicKeyB64: string;
    targetPort: number;
  }): Promise<void> {
    return this.store.grant(input);
  }

  revokeGrant(serviceId: string): Promise<void> {
    return this.store.revokeGrant(serviceId);
  }

  isGranted(input: {
    serviceId: string;
    sourceDaemonPublicKeyB64: string;
    targetPort: number;
  }): Promise<boolean> {
    return this.store.isGranted(input);
  }

  private registerRoute(service: RemoteWebService): void {
    this.serviceProxy.registerRemoteWebService({
      hostname: service.hostname,
      port: service.target.port,
      connect: () => {
        if (!this.dataRelay) {
          return Promise.reject(new Error("Data Relay is not configured on this daemon"));
        }
        return connectRemoteWebService(this.dataRelay, service, this.daemonKeyPair, this.logger);
      },
    });
  }
}
