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
 * When the memory index grows past this many characters, the worker's next turn
 * asks it to tidy.
 *
 * The number is about the index, not the notes: detail belongs in memory/ daily
 * notes, and an index past this size is carrying detail it should have left
 * there. That matters because the index is injected into every task's prompt —
 * an untidy index taxes every subsequent piece of work, and nothing else
 * guarantees the "review and tidy regularly" in the standing rules ever happens,
 * since a worker only acts when work arrives.
 */
export const WORKER_MEMORY_TIDY_THRESHOLD = 4_000;

/**
 * The rules that make the worker maintain its own memory.
 *
 * Wording follows the reference product's own instruction shape: update
 * regularly, keep it brief and effective, and a daily note is for the detail
 * while MEMORY.md is the index that survives.
 */
/**
 * The ask that appears when the index has grown past the threshold.
 *
 * Worded as part of the work rather than as a standing chore, because it rides
 * one specific turn: the model should tidy now, not remember to tidy later.
 */
export const WORKER_MEMORY_TIDY_NUDGE = `## Your memory index has grown long

It is past the size an index should be, and it is read at the start of every
task. Tidy it as part of this work: merge duplicates, drop what has gone stale,
move detail into today's note under memory/, and keep the index to one line per
durable fact. Write the tidied version before you finish.`;

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
    // The nudge sits between the memory and the standing rules: here is what
    // you remember, this one needs tidying during this work, and here are the
    // ongoing rules. It is a request from the system and an act by the worker —
    // the worker stays the memory's only author, deciding what to merge, drop,
    // or move to the daily notes.
    const sections =
      trimmed.length > WORKER_MEMORY_TIDY_THRESHOLD
        ? [`## What you remember\n\n${trimmed}`, WORKER_MEMORY_TIDY_NUDGE, WORKER_MEMORY_RULES]
        : [`## What you remember\n\n${trimmed}`, WORKER_MEMORY_RULES];
    return { sections };
  }
  // First run ever: no memories, but the worker still needs to know the
  // mechanism exists, or it will never start one.
  return { sections: [WORKER_MEMORY_RULES] };
}
