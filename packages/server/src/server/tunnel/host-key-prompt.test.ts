import { describe, expect, it } from "vitest";
import { createHostKeyPromptManager, SSH_HOST_KEY_PROMPT_TIMEOUT_MS } from "./host-key-prompt.js";

function prompt(id: string, kind: "first-use" | "changed" = "first-use") {
  return {
    promptId: id,
    target: "example.com",
    kind,
    fingerprint: `fp-${id}`,
  };
}

describe("createHostKeyPromptManager", () => {
  it("resolves when the client trusts the prompt", async () => {
    const emitted: unknown[] = [];
    const manager = createHostKeyPromptManager({
      emitPrompt: (p) => emitted.push(p),
      scheduleTimeout: () => () => undefined,
    });
    const decision = manager.ask(prompt("p1"));
    expect(emitted).toHaveLength(1);
    const answered = manager.respond({ promptId: "p1", decision: "trust" });
    expect(answered).toBe(true);
    await expect(decision).resolves.toBe("trust");
  });

  it("resolves cancel when the client cancels", async () => {
    const manager = createHostKeyPromptManager({
      emitPrompt: () => undefined,
      scheduleTimeout: () => () => undefined,
    });
    const decision = manager.ask(prompt("p2"));
    manager.respond({ promptId: "p2", decision: "cancel" });
    await expect(decision).resolves.toBe("cancel");
  });

  it("resolves cancel on timeout", async () => {
    let fireTimeout: (() => void) | null = null;
    const manager = createHostKeyPromptManager({
      emitPrompt: () => undefined,
      scheduleTimeout: (callback) => {
        fireTimeout = callback;
        return () => undefined;
      },
    });
    const decision = manager.ask(prompt("p3"));
    fireTimeout?.();
    await expect(decision).resolves.toBe("cancel");
  });

  it("reports false for unknown prompt ids", () => {
    const manager = createHostKeyPromptManager({
      emitPrompt: () => undefined,
      scheduleTimeout: () => () => undefined,
    });
    expect(manager.respond({ promptId: "missing", decision: "trust" })).toBe(false);
  });

  it("cancelAll resolves every pending prompt as cancel", async () => {
    const manager = createHostKeyPromptManager({
      emitPrompt: () => undefined,
      scheduleTimeout: () => () => undefined,
    });
    const d1 = manager.ask(prompt("a"));
    const d2 = manager.ask(prompt("b"));
    manager.cancelAll();
    await expect(d1).resolves.toBe("cancel");
    await expect(d2).resolves.toBe("cancel");
  });

  it("uses the documented prompt timeout", () => {
    expect(SSH_HOST_KEY_PROMPT_TIMEOUT_MS).toBe(120_000);
  });

  it("replacing an identical prompt id cancels the earlier ask", async () => {
    const manager = createHostKeyPromptManager({
      emitPrompt: () => undefined,
      scheduleTimeout: () => () => undefined,
    });
    const first = manager.ask(prompt("dup"));
    const second = manager.ask(prompt("dup"));
    await expect(first).resolves.toBe("cancel");
    manager.respond({ promptId: "dup", decision: "trust" });
    await expect(second).resolves.toBe("trust");
  });
});
