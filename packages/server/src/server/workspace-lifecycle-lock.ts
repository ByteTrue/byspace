import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const lifecycleLocks = new Map<string, Promise<void>>();

function lockKey(path: string): string {
  let key: string;
  try {
    key = realpathSync.native(path);
  } catch {
    key = resolve(path);
  }
  return process.platform === "win32" ? key.toLowerCase() : key;
}

export async function withWorkspaceLifecycleLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = lockKey(path);
  const previous = lifecycleLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const tail = previous.then(() => current);
  lifecycleLocks.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (lifecycleLocks.get(key) === tail) lifecycleLocks.delete(key);
  }
}
