/**
 * Tests for the memory sections a worker's prompt carries.
 *
 * The parts worth pinning: an overgrown index produces a tidy request on the
 * next turn, a healthy one does not, and the request sits between the memory
 * and the standing rules so it reads as being about what was just shown.
 */
import { describe, expect, it } from "vitest";

import {
  buildMemorySections,
  WORKER_MEMORY_RULES,
  WORKER_MEMORY_TIDY_NUDGE,
  WORKER_MEMORY_TIDY_THRESHOLD,
} from "./worker-memory.js";

function memoryOfLength(length: number): string {
  const filler = "- A durable fact about the project that a worker learned.  ";
  let out = "# Memory\n\n";
  while (out.length < length) out += `${filler}\n`;
  return out.slice(0, Math.max(length, 1));
}

describe("worker memory sections", () => {
  it("carries the standing rules even with no memory yet", () => {
    const { sections } = buildMemorySections({ memory: null });
    expect(sections).toEqual([WORKER_MEMORY_RULES]);
  });

  it("shows a healthy memory with rules and no nudge", () => {
    const { sections } = buildMemorySections({ memory: "# Memory\n\n- Short fact." });
    expect(sections).toEqual([expect.stringContaining("Short fact."), WORKER_MEMORY_RULES]);
    expect(sections.join("\n")).not.toContain("grown long");
  });

  it("asks for a tidy when the index passes the threshold", () => {
    const { sections } = buildMemorySections({
      memory: memoryOfLength(WORKER_MEMORY_TIDY_THRESHOLD + 1),
    });
    expect(sections).toContain(WORKER_MEMORY_TIDY_NUDGE);
  });

  it("does not ask at exactly the threshold", () => {
    // The boundary is exclusive: the threshold is the size that is fine, past
    // it is not. A worker whose index is exactly at it should not be interrupted.
    const { sections } = buildMemorySections({
      memory: memoryOfLength(WORKER_MEMORY_TIDY_THRESHOLD),
    });
    expect(sections).not.toContain(WORKER_MEMORY_TIDY_NUDGE);
  });

  it("places the nudge between the memory and the standing rules", () => {
    // Reading order is the point: what you remember, this one needs tidying,
    // and here are the ongoing rules. A nudge buried after the rules reads as
    // background; first it reads as the job at hand.
    const { sections } = buildMemorySections({
      memory: memoryOfLength(WORKER_MEMORY_TIDY_THRESHOLD + 500),
    });
    expect(sections[0]).toContain("What you remember");
    expect(sections[1]).toBe(WORKER_MEMORY_TIDY_NUDGE);
    expect(sections[2]).toBe(WORKER_MEMORY_RULES);
  });

  it("treats whitespace-only memory as no memory", () => {
    const { sections } = buildMemorySections({ memory: "   \n\t " });
    expect(sections).toEqual([WORKER_MEMORY_RULES]);
  });
});
