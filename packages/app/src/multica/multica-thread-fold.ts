/**
 * The timeline's thread fold, translated from the source's
 * foldResolvedThreads: a resolved root collapses its whole thread to the
 * root; a thread whose conclusion lives in a resolved reply keeps the root
 * plus the latest-resolved reply and folds the rest; an open thread keeps
 * everything. The fold is a read-side projection — the rows stay in the
 * store, and the reader can pull the folded comments back (our UI does it
 * with a local "show" toggle).
 */
export interface FoldInput {
  readonly id: string;
  readonly parentId: string | null;
  readonly resolvedAt: string | null;
}

export interface ThreadFoldResult<T extends FoldInput> {
  /** The entries the fold keeps, in their input order. */
  readonly visible: readonly T[];
  /** Per kept root: how many of its comments the fold hid. */
  readonly foldedByRoot: ReadonlyMap<string, number>;
}

export function foldThreads<T extends FoldInput>(entries: readonly T[]): ThreadFoldResult<T> {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  const rootOf = (entry: T): T => {
    let current = entry;
    for (let hop = 0; hop < entries.length; hop += 1) {
      if (current.parentId === null) return current;
      const parent = byId.get(current.parentId);
      if (!parent) return current;
      current = parent;
    }
    return current;
  };

  interface Thread {
    root: T;
    replies: T[];
  }
  const threads = new Map<string, Thread>();
  for (const entry of entries) {
    const root = rootOf(entry);
    let thread = threads.get(root.id);
    if (!thread) {
      thread = { root, replies: [] };
      threads.set(root.id, thread);
    }
    if (entry.id !== root.id) {
      thread.replies.push(entry);
    }
  }

  const keep = new Set<string>();
  const foldedByRoot = new Map<string, number>();
  for (const [rootId, thread] of threads) {
    if (thread.root.resolvedAt !== null) {
      keep.add(rootId);
      foldedByRoot.set(rootId, thread.replies.length);
      continue;
    }
    let resolution: T | null = null;
    for (const reply of thread.replies) {
      if (reply.resolvedAt === null) continue;
      const resolutionStamp = resolution?.resolvedAt ?? null;
      if (resolutionStamp === null || reply.resolvedAt > resolutionStamp) {
        resolution = reply;
      }
    }
    if (resolution === null) {
      keep.add(rootId);
      for (const reply of thread.replies) {
        keep.add(reply.id);
      }
      continue;
    }
    keep.add(rootId);
    keep.add(resolution.id);
    foldedByRoot.set(rootId, thread.replies.length - 1);
  }

  return {
    visible: entries.filter((entry) => keep.has(entry.id)),
    foldedByRoot,
  };
}
