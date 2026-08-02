/**
 * The output a hidden client missed, kept so it can be resumed instead of reset.
 *
 * A client that stops subscribing (a Terminal whose workspace is not showing)
 * keeps its own renderer contents, so replaying a snapshot over it throws away
 * scrollback the client still had. What it actually needs is the gap: the
 * output produced between the revision it last received and now.
 *
 * Bounded by characters, not bytes: `data.length` is free and the string is
 * already in memory. Worst case is 2 bytes per unit, so a 1M-char budget holds
 * at most ~2 MiB per terminal.
 */

// The gap a Terminal accumulates while its workspace is hidden. Well past a
// normal switch (kilobytes), short of a runaway producer nobody is watching.
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
  /** Everything at or below this is gone; resuming from earlier would skip output. */
  private droppedThroughRevision = 0;
  private lastRevision = 0;

  constructor(options?: { maxChars?: number }) {
    this.maxChars = options?.maxChars ?? MAX_TERMINAL_RESUME_BACKLOG_CHARS;
  }

  append(revision: number | undefined, data: string): void {
    if (revision === undefined) {
      // Unnumbered output cannot be placed in the sequence, so nothing before
      // the next numbered chunk can be resumed across it.
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
    if (revision > this.lastRevision) {
      // The client claims output this terminal never produced (a restarted
      // terminal reusing an id, or a stale record). Do not guess.
      return null;
    }
    if (revision < this.droppedThroughRevision) {
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
