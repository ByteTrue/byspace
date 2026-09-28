import { describe, expect, it } from "vitest";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  getAgentControlHintKey,
  normalizeModelId,
  resolveAgentModelSelection,
  resolveThinkingTriggerLabel,
} from "./utils";

describe("getAgentControlHintKey", () => {
  it("returns translation keys for each editable agent control hint", () => {
    expect(getAgentControlHintKey("thinking")).toBe("agentControls.hints.thinking");
    expect(getAgentControlHintKey("model")).toBe("agentControls.hints.model");
    expect(getAgentControlHintKey("mode")).toBe("agentControls.hints.mode");
  });
});

describe("feature metadata helpers", () => {
  it("prefers explicit feature tooltip copy", () => {
    expect(
      getFeatureTooltip({
        label: "Plan",
        tooltip: "Toggle plan mode",
      }),
    ).toBe("Toggle plan mode");
  });

  it("falls back to the feature label when no tooltip is provided", () => {
    expect(
      getFeatureTooltip({
        label: "Custom",
      }),
    ).toBe("Custom");
  });

  it("maps feature highlight colors by feature id", () => {
    expect(getFeatureHighlightColor("fast_mode")).toBe("yellow");
    expect(getFeatureHighlightColor("plan_mode")).toBe("blue");
    expect(getFeatureHighlightColor("other")).toBe("default");
  });
});

describe("normalizeModelId", () => {
  it("treats empty values as unset", () => {
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });

  it("returns trimmed model ids", () => {
    expect(normalizeModelId(" gpt-5.1-codex ")).toBe("gpt-5.1-codex");
    expect(normalizeModelId(" default ")).toBe("default");
  });
});

describe("resolveAgentModelSelection", () => {
  it("resolves a configured model alias to its canonical catalog model", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          provider: "claude",
          id: "claude-fable-5",
          aliases: ["claude-fable-5[1m]"],
          label: "Fable 5",
          thinkingOptions: [{ id: "high", label: "High" }],
          defaultThinkingOptionId: "high",
        },
      ],
      runtimeModelId: null,
      configuredModelId: "claude-fable-5[1m]",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("claude-fable-5");
    expect(selection.displayModel).toBe("Fable 5");
    expect(selection.selectedThinkingId).toBe("high");
  });

  it("prefers runtime model over configured model", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: "b",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("a");
    expect(selection.displayModel).toBe("Model A");
    expect(selection.selectedThinkingId).toBe("low");
  });

  it("uses explicit thinking option when provided", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "high",
    });

    expect(selection.selectedThinkingId).toBe("high");
    expect(selection.displayThinking).toBe("High");
  });

  it("formats raw thinking labels in the selected model display", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "claude",
          label: "Model A",
          thinkingOptions: [
            { id: "none", label: "none" },
            { id: "xhigh", label: "xhigh" },
          ],
        },
      ],
      runtimeModelId: "a",
      configuredModelId: null,
      explicitThinkingOptionId: "xhigh",
    });

    expect(selection.selectedThinkingId).toBe("xhigh");
    expect(selection.displayThinking).toBe("Extra high");
  });

  it("falls back to the provider default model label instead of Auto", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "a",
          provider: "codex",
          label: "Model A",
          isDefault: true,
          thinkingOptions: [{ id: "low", label: "Low" }],
          defaultThinkingOptionId: "low",
        },
      ],
      runtimeModelId: null,
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.displayModel).toBe("Model A");
    expect(selection.displayThinking).toBe("Low");
  });

  it("prefers the configured model when runtime model is not in the model list", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "default",
          provider: "claude",
          label: "Default (Sonnet 4.6)",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "claude-sonnet-4-6-20260101",
      configuredModelId: "default",
      explicitThinkingOptionId: null,
    });

    expect(selection.activeModelId).toBe("default");
    expect(selection.displayModel).toBe("Default (Sonnet 4.6)");
    expect(selection.selectedThinkingId).toBe("low");
    expect(selection.displayThinking).toBe("Low");
  });

  it("keeps a session model absent from the catalog instead of adopting the fallback entry", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "qwen3.8-max",
          provider: "pi",
          label: "Qwen3.8 Max",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "glm-5.3-flash",
      configuredModelId: "glm-5.3-flash",
      explicitThinkingOptionId: "high",
    });

    // The session runs glm-5.3-flash, which the (still loading or stale)
    // catalog does not list. The picker must not render Qwen3.8 Max — the
    // raw id stays selected so the trigger shows the session's real model.
    expect(selection.selectedModel).toBeNull();
    expect(selection.activeModelId).toBe("glm-5.3-flash");
    expect(selection.displayModel).toBe("glm-5.3-flash");
    expect(selection.thinkingOptions).toBeNull();
  });

  it("keeps the configured thinking level instead of silently rendering the lowest option", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "qwen3.8-max",
          provider: "pi",
          label: "Qwen3.8 Max",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "xhigh", label: "Extra high" },
          ],
        },
      ],
      runtimeModelId: "qwen3.8-max",
      configuredModelId: "qwen3.8-max",
      // The session was configured at "max"; the catalog lists no "max".
      // Displaying "Low" (options[0]) reads as the setting being changed.
      explicitThinkingOptionId: "max",
    });

    expect(selection.selectedThinkingId).toBe("max");
    expect(selection.displayThinking).toBe("Max");
  });

  it("falls back to the first option only when no explicit level is configured", () => {
    const selection = resolveAgentModelSelection({
      models: [
        {
          id: "qwen3.8-max",
          provider: "pi",
          label: "Qwen3.8 Max",
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
          ],
        },
      ],
      runtimeModelId: "qwen3.8-max",
      configuredModelId: null,
      explicitThinkingOptionId: null,
    });

    expect(selection.selectedThinkingId).toBe("low");
    expect(selection.displayThinking).toBe("Low");
  });

  it("formats a configured but unloaded thinking level as its label", () => {
    const label = resolveThinkingTriggerLabel({
      options: undefined,
      selectedId: "max",
      unknownLabel: "Unknown",
    });

    expect(label).toBe("Max");
  });

  it("shows the unknown label when nothing is selected", () => {
    const label = resolveThinkingTriggerLabel({
      options: [{ id: "low", label: "Low" }],
      selectedId: undefined,
      unknownLabel: "Unknown",
    });

    expect(label).toBe("Unknown");
  });

  it("renders the raw selected id when it is not among the loaded options", () => {
    const label = resolveThinkingTriggerLabel({
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
      ],
      selectedId: "xhigh",
      unknownLabel: "Unknown",
    });

    expect(label).toBe("Extra high");
  });
});
