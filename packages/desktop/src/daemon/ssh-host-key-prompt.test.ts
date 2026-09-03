import { describe, expect, it, vi } from "vitest";
import {
  createHostKeyPromptManager,
  SSH_HOST_KEY_PROMPT_TIMEOUT_MS,
  type SshHostKeyPrompt,
} from "./ssh-host-key-prompt";

const FIRST_USE_PROMPT: SshHostKeyPrompt = {
  promptId: "p1",
  target: "deploy@example.com",
  kind: "first-use",
  fingerprint: "SHA256:abc",
};

function createHarness() {
  const emitted: SshHostKeyPrompt[] = [];
  const timeouts: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];
  const manager = createHostKeyPromptManager({
    emitPrompt: (prompt) => emitted.push(prompt),
    scheduleTimeout(callback, delayMs) {
      const entry = { callback, delayMs, cancelled: false };
      timeouts.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  return { emitted, manager, timeouts };
}

describe("createHostKeyPromptManager", () => {
  it("emits the prompt and resolves with the user decision", async () => {
    const { emitted, manager, timeouts } = createHarness();
    const promise = manager.ask(FIRST_USE_PROMPT);

    expect(emitted).toEqual([FIRST_USE_PROMPT]);
    expect(timeouts[0]?.delayMs).toBe(SSH_HOST_KEY_PROMPT_TIMEOUT_MS);

    manager.respond({ promptId: "p1", decision: "trust" });
    await expect(promise).resolves.toBe("trust");
    expect(timeouts[0]?.cancelled).toBe(true);
  });

  it("resolves as cancel when the user rejects", async () => {
    const { manager } = createHarness();
    const promise = manager.ask(FIRST_USE_PROMPT);
    manager.respond({ promptId: "p1", decision: "cancel" });
    await expect(promise).resolves.toBe("cancel");
  });

  it("expires an unanswered prompt as cancel", async () => {
    const { manager, timeouts } = createHarness();
    const promise = manager.ask(FIRST_USE_PROMPT);
    timeouts[0]?.callback();
    await expect(promise).resolves.toBe("cancel");
    // A late answer for the expired prompt is ignored.
    manager.respond({ promptId: "p1", decision: "trust" });
    await expect(promise).resolves.toBe("cancel");
  });

  it("returns the same promise for a duplicate prompt id", async () => {
    const { emitted, manager } = createHarness();
    const first = manager.ask(FIRST_USE_PROMPT);
    const second = manager.ask(FIRST_USE_PROMPT);

    expect(second).toBe(first);
    expect(emitted).toHaveLength(1);

    manager.respond({ promptId: "p1", decision: "trust" });
    await expect(second).resolves.toBe("trust");
  });

  it("cancelAll settles every pending prompt as cancel", async () => {
    const { manager } = createHarness();
    const first = manager.ask(FIRST_USE_PROMPT);
    const second = manager.ask({ ...FIRST_USE_PROMPT, promptId: "p2" });

    manager.cancelAll();
    await expect(first).resolves.toBe("cancel");
    await expect(second).resolves.toBe("cancel");
  });

  it("ignores responses for unknown prompt ids", () => {
    const { manager } = createHarness();
    expect(() => manager.respond({ promptId: "missing", decision: "trust" })).not.toThrow();
  });

  it("does not leave timers pending after a decision", async () => {
    vi.useFakeTimers();
    try {
      const { manager } = createHarness();
      const promise = manager.ask(FIRST_USE_PROMPT);
      manager.respond({ promptId: "p1", decision: "trust" });
      await expect(promise).resolves.toBe("trust");
      vi.advanceTimersByTime(SSH_HOST_KEY_PROMPT_TIMEOUT_MS + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
