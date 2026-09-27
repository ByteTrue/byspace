/**
 * A worker's memory: what survives the end of one task into the start of the
 * next.
 *
 * The reference product keeps long-term memory as files in the worker's own
 * directory — MEMORY.md as the stable index, daily notes under memory/ — and the
 * worker maintains them itself: the system prompt carries when to update them,
 * and the worker has a shell, so writing its memory is an ordinary file write.
 * Nothing in the daemon extracts or summarises on its behalf, which is the
 * decision to copy: a daemon-side summariser is a second model voice deciding
 * what the worker "should" remember, and every extra voice is one more place a
 * memory can drift from what the worker actually concluded.
 *
 * Pure and I/O-free: the runner reads the file, this module turns it into
 * prompt sections. The file itself belongs to the worker's workspace, created
 * the first time the worker writes it, absent until then — an empty memory is
 * no memory rather than a placeholder.
 */

/** The memory file's name inside the worker's workspace. */
export const WORKER_MEMORY_FILENAME = "MEMORY.md";

/**
 * The rules that make the worker maintain its own memory.
 *
 * Wording follows the reference product's own instruction shape: update
 * regularly, keep it brief and effective, and a daily note is for the detail
 * while MEMORY.md is the index that survives.
 */
export const WORKER_MEMORY_RULES = `## When to update your memory

- You have a MEMORY.md in your workspace root and a memory/ directory for daily
  notes. They are yours to maintain, with your ordinary tools.
- When you learn a durable fact — how this project is built, what an owner
  prefers, what a previous task concluded — append it to today's note under
  memory/ and, if it matters beyond today, add one line to MEMORY.md's index.
- Review and tidy MEMORY.md regularly; keep it short and effective. Detail lives
  in the daily notes; the index is what the next task starts from.`;

export interface BuildMemorySectionsInput {
  /** MEMORY.md's contents, or null when the worker has never written one. */
  memory: string | null;
}

export interface MemorySections {
  /** Sections to append after the role prompt, empty for a memory-less worker. */
  sections: string[];
}

/**
 * Turn a worker's memory into prompt sections.
 *
 * A null memory produces nothing at all rather than an empty section: the
 * worker that has never remembered anything should see no memory heading, only
 * the rules that tell it the file is there to start.
 */
export function buildMemorySections(input: BuildMemorySectionsInput): MemorySections {
  const trimmed = input.memory?.trim();
  if (trimmed && trimmed.length > 0) {
    return {
      sections: [`## What you remember\n\n${trimmed}`, WORKER_MEMORY_RULES],
    };
  }
  // First run ever: no memories, but the worker still needs to know the
  // mechanism exists, or it will never start one.
  return { sections: [WORKER_MEMORY_RULES] };
}
