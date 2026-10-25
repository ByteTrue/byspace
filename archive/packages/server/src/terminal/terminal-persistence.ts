import { promises as fs } from "node:fs";
import type { Logger } from "pino";
import type { TerminalManager } from "./terminal-manager.js";
import type { PersistedTerminalSession, TerminalSessionStore } from "./terminal-session-store.js";

// Daemon restarts — crash recovery, auto-update, manual restart, a machine
// sleep that took the daemon down — otherwise lose every terminal tab, because
// sessions live only in the terminal worker process. This wrapper mirrors
// membership changes (create / exit / kill) into a TerminalSessionStore so the
// daemon can recreate the tabs at startup. Processes and scrollback are not
// preserved: restored terminals are fresh shells that reuse the original id,
// so client-side layout references keep resolving.

export function createPersistingTerminalManager(input: {
  inner: TerminalManager;
  store: TerminalSessionStore;
  logger: Logger;
}): TerminalManager {
  const { inner, store, logger } = input;
  const recordsById = new Map<string, PersistedTerminalSession>();
  let lastWrittenJson = "";
  let frozen = false;

  function scheduleWrite(): void {
    const records = Array.from(recordsById.values());
    const json = JSON.stringify(records);
    if (json === lastWrittenJson) {
      return;
    }
    lastWrittenJson = json;
    store.replace(records).catch((error) => {
      logger.warn({ err: error }, "Failed to persist terminal session metadata");
    });
  }

  const unsubscribe = inner.subscribeTerminalsChanged((event) => {
    if (frozen) {
      return;
    }
    // The event carries the authoritative post-mutation list for one cwd
    // bucket. Creations are recorded by the wrapped createTerminal; here we
    // only mirror removals (shell exit, killTerminal, workspace teardown).
    const liveIds = new Set(event.terminals.map((terminal) => terminal.id));
    let changed = false;
    for (const record of recordsById.values()) {
      if (record.cwd === event.cwd && !liveIds.has(record.id)) {
        recordsById.delete(record.id);
        changed = true;
      }
    }
    if (changed) {
      scheduleWrite();
    }
  });
  void unsubscribe;

  return {
    ...inner,
    async createTerminal(options) {
      const session = await inner.createTerminal(options);
      if (frozen) {
        return session;
      }
      // A short-lived command can exit before createTerminal resolves; its exit
      // was mirrored (or dropped) before this record existed. Recording it now
      // would resurrect a dead terminal on the next boot.
      if (!inner.getTerminal(session.id)) {
        return session;
      }
      const record: PersistedTerminalSession = {
        id: session.id,
        cwd: session.cwd,
        workspaceId: session.workspaceId,
        name: session.name,
        ...(options.command ? { command: options.command } : {}),
        ...(options.args ? { args: options.args } : {}),
      };
      recordsById.set(record.id, record);
      scheduleWrite();
      return session;
    },
    killAll() {
      // killAll is shutdown-only (bootstrap stop / worker teardown). Terminals
      // killed here must survive in the store so the next daemon boot restores
      // their tabs, so the mirror is frozen permanently instead of tracking
      // these removals. The daemon process does not use the manager afterwards.
      frozen = true;
      inner.killAll();
    },
  };
}

export async function restorePersistedTerminals(input: {
  manager: TerminalManager;
  store: TerminalSessionStore;
  isWorkspaceActive: (workspaceId: string) => Promise<boolean>;
  logger: Logger;
}): Promise<void> {
  const { manager, store, isWorkspaceActive, logger } = input;
  let records: PersistedTerminalSession[];
  try {
    records = await store.load();
  } catch (error) {
    logger.warn({ err: error }, "Skipping terminal tab restore: store unreadable");
    return;
  }
  if (records.length === 0) {
    return;
  }

  const survivors: PersistedTerminalSession[] = [];
  for (const record of records) {
    try {
      if (!(await isWorkspaceActive(record.workspaceId))) {
        logger.info(
          { terminalId: record.id, workspaceId: record.workspaceId },
          "Dropping persisted terminal: workspace gone",
        );
        continue;
      }
      const stat = await fs.stat(record.cwd);
      if (!stat.isDirectory()) {
        logger.info(
          { terminalId: record.id, cwd: record.cwd },
          "Dropping persisted terminal: cwd missing",
        );
        continue;
      }
      await manager.createTerminal({
        id: record.id,
        cwd: record.cwd,
        workspaceId: record.workspaceId,
        name: record.name,
        ...(record.command ? { command: record.command } : {}),
        ...(record.args ? { args: record.args } : {}),
      });
      survivors.push(record);
    } catch (error) {
      logger.warn(
        { err: error, terminalId: record.id, cwd: record.cwd },
        "Failed to restore persisted terminal",
      );
    }
  }

  try {
    await store.replace(survivors);
  } catch (error) {
    logger.warn({ err: error }, "Failed to rewrite terminal session store after restore");
  }
  logger.info(
    { restored: survivors.length, dropped: records.length - survivors.length },
    "Terminal tabs restored",
  );
}
