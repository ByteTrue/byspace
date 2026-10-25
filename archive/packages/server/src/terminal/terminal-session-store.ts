import { promises as fs } from "node:fs";
import { z } from "zod";
import { writeJsonFileAtomic } from "../server/atomic-file.js";

// Terminal sessions live only in the daemon (and its terminal worker) process.
// This store persists just enough metadata to recreate the tabs — not the
// processes or their scrollback — after a daemon restart. Written on every
// membership change (create/exit/kill) via the persisting manager wrapper.
export const PersistedTerminalSessionSchema = z.strictObject({
  id: z.string().min(1),
  cwd: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
});

export type PersistedTerminalSession = z.infer<typeof PersistedTerminalSessionSchema>;

const PersistedTerminalSessionFileSchema = z.array(PersistedTerminalSessionSchema);

export class TerminalSessionStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<PersistedTerminalSession[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    try {
      return PersistedTerminalSessionFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      // A corrupt file must never block daemon startup; the next membership
      // change rewrites it from the live mirror.
      throw new Error(`Corrupt terminal session store at ${this.filePath}: ${String(error)}`, {
        cause: error,
      });
    }
  }

  async loadOrNull(): Promise<PersistedTerminalSession[] | null> {
    try {
      return await this.load();
    } catch {
      return null;
    }
  }

  replace(records: readonly PersistedTerminalSession[]): Promise<void> {
    const next = this.writeQueue.then(() => writeJsonFileAtomic(this.filePath, records));
    // Keep the queue alive after a failed write so later writes still run.
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
}
