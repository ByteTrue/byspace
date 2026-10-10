import { open, stat } from "node:fs/promises";

import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import type { SubagentObservation } from "../../provider-subagents/observation.js";
import { mapPiSubagentStatus } from "./agent-subagents.js";
import { PiHistoryMapper } from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";
import { resolvePiSessionsDir, walkJsonlFiles } from "./session-descriptor.js";

export const PI_SUBAGENT_TERMINAL_STATUSES = ["completed", "failed", "canceled"] as const;

const DEFAULT_POLL_MS = 1_000;
const LOCATE_RETRY_MS = 5_000;
const TERMINAL_DRAIN_GRACE_MS = 3_000;

interface PiSubagentMessageEntry {
  timestamp?: unknown;
  message?: unknown;
}

export interface PiSubagentTailerSnapshot {
  subagentId: string;
  sessionId?: string;
  sessionFile?: string;
  cwd?: string;
  status?: string;
}

/**
 * Extract the tailer-relevant fields from a pi-subagent report record. The subagent id is
 * required (it keys the tailer); session references start the tail, status tracks the end.
 * Status-only snapshots matter too: they flip the entry to terminal so the tail stops.
 */
export function parsePiSubagentTailerSnapshot(record: unknown): PiSubagentTailerSnapshot | null {
  if (typeof record !== "object" || record === null) return null;
  const source = record as Record<string, unknown>;
  const subagentId = readString(source.id);
  if (!subagentId) return null;
  const snapshot: PiSubagentTailerSnapshot = { subagentId };
  for (const key of ["sessionId", "sessionFile", "cwd", "status"] as const) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) snapshot[key] = value;
  }
  return snapshot.sessionId || snapshot.sessionFile || snapshot.cwd || snapshot.status
    ? snapshot
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

interface PiSubagentTailerEntry {
  agentId: string;
  subagentId: string;
  sessionId: string | null;
  sessionFile: string | null;
  cwd: string | null;
  tailer: PiSubagentJsonlTailer | null;
  lastLocateAttempt: number;
  terminalAt: number | null;
}

interface PiSubagentJsonlTailer {
  file: string;
  offset: number;
  mapper: PiHistoryMapper;
}

async function drainPiSessionTailer(
  tailer: PiSubagentJsonlTailer,
  onTimeline: (item: AgentTimelineItem, timestamp: string | undefined) => void,
): Promise<void> {
  const info = await stat(tailer.file).catch(() => null);
  if (!info?.isFile()) return;
  if (info.size < tailer.offset) {
    // File shrank (recreated): restart from the beginning with fresh mapper state.
    tailer.offset = 0;
    tailer.mapper = new PiHistoryMapper("pi");
  }
  if (info.size === tailer.offset) return;

  const handle = await open(tailer.file, "r");
  try {
    const length = info.size - tailer.offset;
    const buffer = Buffer.alloc(length);
    // A short read means the file was truncated between stat and read; parse only
    // the bytes that actually arrived.
    const { bytesRead } = await handle.read(buffer, 0, length, tailer.offset);
    const text = buffer.toString("utf8", 0, bytesRead);
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) return;
    const chunk = text.slice(0, lastNewline + 1);
    tailer.offset += Buffer.byteLength(chunk);

    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (typeof entry !== "object" || entry === null) continue;
      const message = (entry as PiSubagentMessageEntry).message;
      if (typeof message !== "object" || message === null) continue;
      const timestamp = readString((entry as PiSubagentMessageEntry).timestamp) ?? undefined;
      const events = tailer.mapper.mapMessages([message as PiAgentMessage]);
      for (const event of events) {
        if (event.type === "timeline") {
          onTimeline(event.item, timestamp);
        }
      }
    }
  } finally {
    await handle.close();
  }
}

export async function locatePiSubagentSessionFile(
  sessionId: string,
  options: { cwd?: string | null; env?: NodeJS.ProcessEnv; homeDir?: string } = {},
): Promise<string | null> {
  const sessionsDir = await resolvePiSessionsDir({
    cwd: options.cwd ?? undefined,
    env: options.env ?? process.env,
    homeDir: options.homeDir,
  });
  const suffix = `_${sessionId}.jsonl`;
  const files = await walkJsonlFiles(sessionsDir);
  return files.find((file) => file.endsWith(suffix)) ?? null;
}

export interface PiSubagentSessionTailersOptions {
  emit: (agentId: string, observation: SubagentObservation) => void;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Test hook: shrink the drain grace between a terminal report and tail teardown. */
  terminalGraceMs?: number;
}

export class PiSubagentSessionTailers {
  private readonly entries = new Map<string, PiSubagentTailerEntry>();
  private readonly options: PiSubagentSessionTailersOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: PiSubagentSessionTailersOptions) {
    this.options = options;
  }

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, DEFAULT_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  update(agentId: string, snapshot: PiSubagentTailerSnapshot): void {
    const subagentId = snapshot.subagentId;
    const key = `${agentId}\u0000${subagentId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        agentId,
        subagentId,
        sessionId: null,
        sessionFile: null,
        cwd: null,
        tailer: null,
        lastLocateAttempt: 0,
        terminalAt: null,
      };
      this.entries.set(key, entry);
      this.start();
    }
    if (snapshot.sessionId) entry.sessionId = snapshot.sessionId;
    if (snapshot.sessionFile) entry.sessionFile = snapshot.sessionFile;
    if (snapshot.cwd) entry.cwd = snapshot.cwd;

    const status = mapPiSubagentStatus(snapshot.status ?? "");
    if (
      status &&
      (PI_SUBAGENT_TERMINAL_STATUSES as readonly string[]).includes(status) &&
      entry.terminalAt === null
    ) {
      entry.terminalAt = Date.now();
    }
    // No reopen-on-running: reports have no ordering guarantee, so a stale running
    // snapshot must not resurrect a finished subagent's tail. New launches are new ids.
  }

  removeAgent(agentId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.agentId === agentId) this.entries.delete(key);
    }
  }

  dispose(): void {
    this.stop();
    this.entries.clear();
  }

  /**
   * Drain every entry once. Timer and manual (test) ticks serialize through a promise
   * chain instead of skipping, so an awaited tick never no-ops behind an in-flight one.
   */
  tick(): Promise<void> {
    const run = this.queue.then(() => this.drain());
    this.queue = run.catch(() => {});
    return run;
  }

  private async drain(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (!entry.tailer && now - entry.lastLocateAttempt >= LOCATE_RETRY_MS) {
        entry.lastLocateAttempt = now;
        entry.tailer = await this.locate(entry);
      }
      if (entry.tailer) {
        try {
          await drainPiSessionTailer(entry.tailer, (item, timestamp) => {
            this.options.emit(entry.agentId, {
              kind: "timeline",
              id: entry.subagentId,
              item,
              ...(timestamp ? { timestamp } : {}),
            });
          });
        } catch {
          // Transient read failures (rotation, permissions): retry next tick.
        }
      }
      if (
        entry.terminalAt !== null &&
        now >= entry.terminalAt + (this.options.terminalGraceMs ?? TERMINAL_DRAIN_GRACE_MS)
      ) {
        this.entries.delete(key);
      }
    }
  }

  private async locate(entry: PiSubagentTailerEntry): Promise<PiSubagentJsonlTailer | null> {
    const file =
      entry.sessionFile ??
      (entry.sessionId
        ? await locatePiSubagentSessionFile(entry.sessionId, {
            cwd: entry.cwd,
            env: this.options.env,
            homeDir: this.options.homeDir,
          })
        : null);
    if (!file) return null;
    return { file, offset: 0, mapper: new PiHistoryMapper("pi") };
  }
}
