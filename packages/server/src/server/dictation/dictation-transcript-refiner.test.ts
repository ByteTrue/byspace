import { describe, expect, it, vi } from "vitest";

import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import type { StructuredTextGeneration } from "../session/checkout/git-metadata-generator.js";
import { createDictationTranscriptRefiner } from "./dictation-transcript-refiner.js";

const agent = {
  id: "agent-1",
  cwd: "/tmp/project",
  config: { provider: "pi", model: "openai/gpt-5", thinkingOptionId: "high" },
} as ManagedAgent;

function managerWithAgent(value: ManagedAgent | null = agent): Pick<AgentManager, "getAgent"> {
  return { getAgent: () => value } as Pick<AgentManager, "getAgent">;
}

function generationReturning(value: unknown): {
  generation: StructuredTextGeneration;
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async () => value);
  return { generation: { generate } as unknown as StructuredTextGeneration, generate };
}

const logger = { warn: vi.fn() };

describe("dictation transcript refinement", () => {
  it("uses the shared structured-generation path with the current Agent selection", async () => {
    const { generation, generate } = generationReturning({
      text: "先检查 src/app.ts，然后运行 2 个测试。",
    });
    const refiner = createDictationTranscriptRefiner({
      agentManager: managerWithAgent(),
      generation,
      isEnabled: () => true,
      logger,
    });

    await expect(
      refiner.refine({
        requestId: "refine-1",
        text: "先检查 src/app.ts 然后运行 2 个测试",
        agentId: "agent-1",
      }),
    ).resolves.toEqual({ text: "先检查 src/app.ts，然后运行 2 个测试。", refined: true });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/project",
        schemaName: "DictationTranscriptRefinement",
        agentTitle: "Dictation transcript refiner",
        currentSelection: {
          provider: "pi",
          model: "openai/gpt-5",
          thinkingOptionId: "high",
        },
      }),
    );
  });

  it("fails open when disabled, unavailable, or generation fails", async () => {
    const source = "不要修改 src/app.ts 的 2 个测试";
    const { generation, generate } = generationReturning({ text: "整理结果" });

    const disabled = createDictationTranscriptRefiner({
      agentManager: managerWithAgent(),
      generation,
      isEnabled: () => false,
      logger,
    });
    await expect(
      disabled.refine({ requestId: "disabled", text: source, agentId: "agent-1" }),
    ).resolves.toEqual({ text: source, refined: false });
    expect(generate).not.toHaveBeenCalled();

    const unavailable = createDictationTranscriptRefiner({
      agentManager: managerWithAgent(null),
      generation,
      isEnabled: () => true,
      logger,
    });
    await expect(
      unavailable.refine({ requestId: "unavailable", text: source, agentId: "missing" }),
    ).resolves.toEqual({ text: source, refined: false });

    const failed = createDictationTranscriptRefiner({
      agentManager: managerWithAgent(),
      generation: {
        generate: async () => {
          throw new Error("provider unavailable");
        },
      },
      isEnabled: () => true,
      logger,
    });
    await expect(
      failed.refine({ requestId: "failed", text: source, agentId: "agent-1" }),
    ).resolves.toEqual({ text: source, refined: false });
  });
});
