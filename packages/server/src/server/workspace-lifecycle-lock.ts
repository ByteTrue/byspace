import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const lifecycleLocks = new Map<string, Promise<void>>();
const heldLifecycleKeys = new AsyncLocalStorage<ReadonlySet<string>>();

function pathLockKey(path: string): string {
  let key: string;
  try {
    key = realpathSync.native(path);
  } catch {
    key = resolve(path);
  }
  const normalized = process.platform === "win32" ? key.toLowerCase() : key;
  return `path:${normalized}`;
}

async function withLifecycleKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const heldKeys = heldLifecycleKeys.getStore();
  if (heldKeys?.has(key)) return operation();

  const previous = lifecycleLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const tail = previous.then(() => current);
  lifecycleLocks.set(key, tail);

  await previous;
  try {
    const nextHeldKeys = new Set(heldKeys);
    nextHeldKeys.add(key);
    return await heldLifecycleKeys.run(nextHeldKeys, operation);
  } finally {
    release();
    if (lifecycleLocks.get(key) === tail) lifecycleLocks.delete(key);
  }
}

export function withWorkspaceLifecycleLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withLifecycleKey(pathLockKey(path), operation);
}

export function withWorkspaceLifecycleLocks<T>(
  input: { paths?: string[]; projectIds?: string[] },
  operation: () => Promise<T>,
): Promise<T> {
  const keys = [
    ...(input.paths ?? []).map(pathLockKey),
    ...(input.projectIds ?? []).map((projectId) => `project:${projectId}`),
  ]
    .filter(Boolean)
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort();

  const acquire = (index: number): Promise<T> =>
    index >= keys.length ? operation() : withLifecycleKey(keys[index]!, () => acquire(index + 1));
  return acquire(0);
}
