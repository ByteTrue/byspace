import type pino from "pino";
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
    logger: pino.Logger;
  }) {
    this.store = new RemoteWebServiceStore({
      byspaceHome: options.byspaceHome,
      logger: options.logger,
    });
    this.serviceProxy = options.serviceProxy;
    this.dataRelay = options.dataRelay;
    this.logger = options.logger.child({ component: "remote-web-service-manager" });
  }

  private readonly serviceProxy: ServiceProxySubsystem;
  private readonly dataRelay: DataRelayClientConfig | null;
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

  private registerRoute(service: RemoteWebService): void {
    this.serviceProxy.registerRemoteWebService({
      hostname: service.hostname,
      port: service.target.port,
      connect: () => {
        if (!this.dataRelay) {
          return Promise.reject(new Error("Data Relay is not configured on this daemon"));
        }
        return connectRemoteWebService(this.dataRelay, service.target, this.logger);
      },
    });
  }
}
