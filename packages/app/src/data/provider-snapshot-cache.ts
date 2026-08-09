import type { ProviderSnapshotEntry } from "@bytetrue/byspace-protocol/agent-types";
import {
  expandProviderSnapshot,
  type CompactProviderSnapshot,
} from "@bytetrue/byspace-protocol/provider-snapshot-codec";
import { CompactProviderSnapshotSchema } from "@bytetrue/byspace-protocol/messages";

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = "@byspace/provider-snapshot/v1";

interface ProviderSnapshotStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DB_NAME = "byspace-provider-snapshots";
const STORE_NAME = "snapshots";
const DB_VERSION = 1;

function openProviderSnapshotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const indexedDb = globalThis.indexedDB;
    if (!indexedDb) {
      reject(new Error("IndexedDB is unavailable in this runtime."));
      return;
    }
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Failed to open provider snapshot IndexedDB."));
    });
  });
}

function runProviderSnapshotTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Provider snapshot IndexedDB request failed."));
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("Provider snapshot IndexedDB transaction failed."));
    });
  });
}

const indexedDbProviderSnapshotStorage: ProviderSnapshotStorage = {
  async getItem(key) {
    const db = await openProviderSnapshotDb();
    try {
      return (
        (await runProviderSnapshotTx<string | undefined>(db, "readonly", (store) =>
          store.get(key),
        )) ?? null
      );
    } finally {
      db.close();
    }
  },
  async setItem(key, value) {
    const db = await openProviderSnapshotDb();
    try {
      await runProviderSnapshotTx(db, "readwrite", (store) => store.put(value, key));
    } finally {
      db.close();
    }
  },
  async removeItem(key) {
    const db = await openProviderSnapshotDb();
    try {
      await runProviderSnapshotTx(db, "readwrite", (store) => store.delete(key));
    } finally {
      db.close();
    }
  },
};

interface StoredProviderSnapshot {
  version: typeof CACHE_VERSION;
  hash: string;
  generatedAt: string;
  compactSnapshot: CompactProviderSnapshot;
}

export interface CachedProviderSnapshot extends StoredProviderSnapshot {
  entries: ProviderSnapshotEntry[];
}

export interface ProviderSnapshotCache {
  read(serverId: string, cwd: string | null): Promise<CachedProviderSnapshot | null>;
  write(input: {
    serverId: string;
    cwd: string | null;
    hash: string;
    generatedAt: string;
    compactSnapshot: CompactProviderSnapshot;
  }): Promise<void>;
}

export class ProviderSnapshotCacheMissError extends Error {
  constructor() {
    super("Daemon returned not-modified without a cached provider snapshot");
    this.name = "ProviderSnapshotCacheMissError";
  }
}

function cacheKey(serverId: string, cwd: string | null): string {
  return `${CACHE_KEY_PREFIX}:${JSON.stringify([serverId, cwd])}`;
}

function parseStoredProviderSnapshot(value: string): StoredProviderSnapshot | null {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) return null;
  const version = Reflect.get(parsed, "version");
  const hash = Reflect.get(parsed, "hash");
  const generatedAt = Reflect.get(parsed, "generatedAt");
  const compactSnapshot = CompactProviderSnapshotSchema.safeParse(
    Reflect.get(parsed, "compactSnapshot"),
  );
  if (
    version !== CACHE_VERSION ||
    typeof hash !== "string" ||
    typeof generatedAt !== "string" ||
    !compactSnapshot.success
  ) {
    return null;
  }
  return {
    version,
    hash,
    generatedAt,
    compactSnapshot: compactSnapshot.data,
  };
}

async function discardCachedSnapshot(storage: ProviderSnapshotStorage, key: string): Promise<void> {
  try {
    await storage.removeItem(key);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
}

export function createProviderSnapshotCache(
  storage: ProviderSnapshotStorage,
): ProviderSnapshotCache {
  return {
    async read(serverId, cwd) {
      const key = cacheKey(serverId, cwd);
      let value: string | null;
      try {
        value = await storage.getItem(key);
      } catch (error) {
        if (error instanceof Error) return null;
        throw error;
      }
      if (value === null) return null;
      try {
        const stored = parseStoredProviderSnapshot(value);
        if (!stored) {
          await discardCachedSnapshot(storage, key);
          return null;
        }
        return { ...stored, entries: expandProviderSnapshot(stored.compactSnapshot) };
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof RangeError)) {
          throw error;
        }
        await discardCachedSnapshot(storage, key);
        return null;
      }
    },
    async write(input) {
      const stored: StoredProviderSnapshot = {
        version: CACHE_VERSION,
        hash: input.hash,
        generatedAt: input.generatedAt,
        compactSnapshot: input.compactSnapshot,
      };
      try {
        await storage.setItem(cacheKey(input.serverId, input.cwd), JSON.stringify(stored));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    },
  };
}

export const providerSnapshotCache = createProviderSnapshotCache(indexedDbProviderSnapshotStorage);
