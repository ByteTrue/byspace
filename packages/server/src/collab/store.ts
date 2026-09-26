import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CollabSliceRecordSchema,
  type CollabSliceRecord,
} from "@bytetrue/protocol/collab/rpc-schemas";
import { writeJsonFileAtomic } from "../server/atomic-file.js";

const StoredCollabSlicesSchema = z.object({
  records: z.array(CollabSliceRecordSchema),
});

type StoredCollabSlices = z.infer<typeof StoredCollabSlicesSchema>;

const STORE_FILE = join("collab", "slices.json");

/**
 * Self-managed JSON store for the collab validation slice (BYTE-6), per
 * docs/data-model.md: lives under `$BYSPACE_HOME`, validates with Zod on read,
 * writes atomically, no schema migration framework. Mutations are serialized so
 * concurrent creates cannot interleave their read-modify-write cycles.
 */
export class CollabSliceStore {
  private readonly filePath: string;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(byspaceHome: string) {
    this.filePath = join(byspaceHome, STORE_FILE);
  }

  async list(): Promise<CollabSliceRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const parsed = StoredCollabSlicesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Collab slice store is corrupted: ${this.filePath}`);
    }
    return parsed.data.records;
  }

  async create(input: { title: string }): Promise<CollabSliceRecord> {
    const run = this.mutationQueue.then(async () => {
      const records = await this.list();
      const now = new Date().toISOString();
      const record: CollabSliceRecord = {
        id: randomUUID(),
        title: input.title,
        createdAt: now,
        updatedAt: now,
      };
      const stored: StoredCollabSlices = { records: [...records, record] };
      await writeJsonFileAtomic(this.filePath, stored);
      return record;
    });
    this.mutationQueue = run.catch(() => undefined);
    return run;
  }
}
