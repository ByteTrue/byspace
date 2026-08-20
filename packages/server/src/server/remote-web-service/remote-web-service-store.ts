import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type pino from "pino";
import { z } from "zod";
import { importPublicKey } from "@bytetrue/byspace-relay/e2ee";
import { writeJsonFileAtomic } from "../atomic-file.js";

function isValidDaemonPublicKey(value: string): boolean {
  try {
    importPublicKey(value);
    return true;
  } catch {
    return false;
  }
}

const RemoteWebServiceTargetSchema = z.object({
  serverId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  daemonPublicKeyB64: z.string().trim().min(1).refine(isValidDaemonPublicKey),
});

const RemoteWebServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(63),
  hostname: z.string().trim().min(1),
  target: RemoteWebServiceTargetSchema,
  createdAt: z.string().datetime(),
});

const RemoteWebServiceGrantSchema = z.object({
  serviceId: z.string().uuid(),
  sourceDaemonPublicKeyB64: z.string().trim().min(1).refine(isValidDaemonPublicKey),
  targetPort: z.number().int().min(1).max(65_535),
});

const StorePayloadSchema = z.object({
  version: z.literal(1),
  services: z.array(RemoteWebServiceSchema),
  grants: z.array(RemoteWebServiceGrantSchema).optional(),
});

export type RemoteWebServiceTarget = z.infer<typeof RemoteWebServiceTargetSchema>;
export type RemoteWebService = z.infer<typeof RemoteWebServiceSchema>;
export type RemoteWebServiceGrant = z.infer<typeof RemoteWebServiceGrantSchema>;

function normalizeName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (!normalized) throw new Error("Remote Web Service name must contain a letter or number");
  return normalized;
}

export class RemoteWebServiceStore {
  private readonly filePath: string;
  private readonly logger: pino.Logger;
  private readonly services = new Map<string, RemoteWebService>();
  private readonly grants = new Map<string, RemoteWebServiceGrant>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: { byspaceHome: string; logger: pino.Logger }) {
    this.filePath = path.join(options.byspaceHome, "remote-web-services.json");
    this.logger = options.logger.child({ component: "remote-web-service-store" });
  }

  async list(): Promise<RemoteWebService[]> {
    await this.load();
    return Array.from(this.services.values()).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  async create(input: { name: string; target: RemoteWebServiceTarget }): Promise<RemoteWebService> {
    await this.load();
    return this.enqueueMutation(async () => {
      const name = normalizeName(input.name);
      const target = RemoteWebServiceTargetSchema.parse(input.target);
      if (Array.from(this.services.values()).some((service) => service.name === name)) {
        throw new Error(`Remote Web Service already exists: ${name}`);
      }
      const service = RemoteWebServiceSchema.parse({
        id: randomUUID(),
        name,
        hostname: `${name}.remote.localhost`,
        target,
        createdAt: new Date().toISOString(),
      });
      await this.persist([...this.services.values(), service], [...this.grants.values()]);
      this.services.set(service.id, service);
      return service;
    });
  }

  async remove(id: string): Promise<RemoteWebService> {
    await this.load();
    return this.enqueueMutation(async () => {
      const service = this.services.get(id);
      if (!service) throw new Error(`Remote Web Service not found: ${id}`);
      const remaining = Array.from(this.services.values()).filter((entry) => entry.id !== id);
      await this.persist(remaining, [...this.grants.values()]);
      this.services.delete(id);
      return service;
    });
  }

  async grant(input: RemoteWebServiceGrant): Promise<void> {
    await this.load();
    return this.enqueueMutation(async () => {
      const grant = RemoteWebServiceGrantSchema.parse(input);
      const existing = this.grants.get(grant.serviceId);
      if (existing) {
        if (
          existing.sourceDaemonPublicKeyB64 !== grant.sourceDaemonPublicKeyB64 ||
          existing.targetPort !== grant.targetPort
        ) {
          throw new Error(`Remote Web Service grant conflict: ${grant.serviceId}`);
        }
        return;
      }
      await this.persist([...this.services.values()], [...this.grants.values(), grant]);
      this.grants.set(grant.serviceId, grant);
    });
  }

  async revokeGrant(serviceId: string): Promise<void> {
    await this.load();
    return this.enqueueMutation(async () => {
      if (!this.grants.has(serviceId)) return;
      const remaining = [...this.grants.values()].filter((grant) => grant.serviceId !== serviceId);
      await this.persist([...this.services.values()], remaining);
      this.grants.delete(serviceId);
    });
  }

  async isGranted(input: RemoteWebServiceGrant): Promise<boolean> {
    await this.load();
    const grant = RemoteWebServiceGrantSchema.parse(input);
    const existing = this.grants.get(grant.serviceId);
    return (
      existing?.sourceDaemonPublicKeyB64 === grant.sourceDaemonPublicKeyB64 &&
      existing.targetPort === grant.targetPort
    );
  }

  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.loadPromise ??= this.loadFromDisk();
    return this.loadPromise;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const payload = StorePayloadSchema.parse(JSON.parse(raw));
      for (const service of payload.services) this.services.set(service.id, service);
      for (const grant of payload.grants ?? []) this.grants.set(grant.serviceId, grant);
      this.loaded = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.loaded = true;
        return;
      }
      this.logger.error({ err: error, filePath: this.filePath }, "Failed to load remote services");
      throw error;
    }
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(mutation);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private persist(services: RemoteWebService[], grants: RemoteWebServiceGrant[]): Promise<void> {
    return writeJsonFileAtomic(this.filePath, { version: 1, services, grants }, { mode: 0o600 });
  }
}
