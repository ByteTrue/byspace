/**
 * The output a hidden client missed, kept so it can be resumed instead of reset.
 *
 * Bounded by characters because the output is already a string. A one-million
 * character budget uses at most roughly 2 MiB per terminal.
 */
export const MAX_TERMINAL_RESUME_BACKLOG_CHARS = 1_000_000;

interface BacklogEntry {
  revision: number;
  data: string;
}

export interface TerminalBacklogResumption {
  data: string;
  revision: number;
}

export class TerminalOutputBacklog {
  private readonly entries: BacklogEntry[] = [];
  private readonly maxChars: number;
  private chars = 0;
  private droppedThroughRevision = 0;
  private lastRevision = 0;

  constructor(options?: { maxChars?: number }) {
    this.maxChars = options?.maxChars ?? MAX_TERMINAL_RESUME_BACKLOG_CHARS;
  }

  append(revision: number | undefined, data: string): void {
    if (revision === undefined) {
      this.entries.length = 0;
      this.chars = 0;
      this.droppedThroughRevision = Number.POSITIVE_INFINITY;
      return;
    }
    if (this.droppedThroughRevision === Number.POSITIVE_INFINITY) {
      this.droppedThroughRevision = revision - 1;
    }
    this.entries.push({ revision, data });
    this.chars += data.length;
    this.lastRevision = revision;
    this.evictOverBudget();
  }

  since(revision: number): TerminalBacklogResumption | null {
    if (revision > this.lastRevision || revision < this.droppedThroughRevision) {
      return null;
    }
    let data = "";
    for (const entry of this.entries) {
      if (entry.revision > revision) {
        data += entry.data;
      }
    }
    return { data, revision: this.lastRevision };
  }

  private evictOverBudget(): void {
    while (this.chars > this.maxChars && this.entries.length > 0) {
      const evicted = this.entries.shift();
      if (!evicted) {
        return;
      }
      this.chars -= evicted.data.length;
      this.droppedThroughRevision = evicted.revision;
    }
  }
}
