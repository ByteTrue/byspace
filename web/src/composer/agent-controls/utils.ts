import type { AgentFeature, AgentModelDefinition } from "@bytetrue/protocol/agent-types";
import { i18n } from "@/i18n/i18next";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import { FAST_MODE_FEATURE_ID, PLAN_MODE_FEATURE_ID } from "@/agent-controls/policy";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";
export type AgentControlHintKey =
  | "agentControls.hints.thinking"
  | "agentControls.hints.model"
  | "agentControls.hints.mode";

export function getAgentControlHintKey(selector: ExplainedAgentControl): AgentControlHintKey {
  switch (selector) {
    case "thinking":
      return "agentControls.hints.thinking";
    case "model":
      return "agentControls.hints.model";
    case "mode":
      return "agentControls.hints.mode";
    default:
      throw new Error("unreachable");
  }
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case FAST_MODE_FEATURE_ID:
      return "yellow";
    case "auto_accept":
      return "green";
    case PLAN_MODE_FEATURE_ID:
      return "blue";
    default:
      return "default";
  }
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return (
    models.find((model) => model.id === modelId) ??
    models.find((model) => model.aliases?.includes(modelId)) ??
    null
  );
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  // A live session with a concrete model id must not silently adopt another
  // catalog entry (isDefault/first). While a provider snapshot is loading or
  // stale, the session's model can be absent from the rows; substituting the
  // fallback makes the picker render a model the session is not using and
  // reads as "my model was changed". Keep the reference unresolved instead —
  // callers fall back to the raw id for display and selection.
  return findModelById(models, preferredModelId);
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

// A model whose catalog entry is missing the agent's configured thinking level
// must not silently render as the lowest available option: showing "Low" for a
// session configured at "max" reads as the model having been changed. Keep the
// configured id selected and let the display format it as a label instead.
export function resolveThinkingSelection(input: {
  thinkingOptions: ThinkingOption[] | null;
  resolvedThinkingId: string | null;
}): { effectiveThinking: ThinkingOption | null; selectedThinkingId: string | null } {
  const { thinkingOptions, resolvedThinkingId } = input;
  if (!resolvedThinkingId) {
    return {
      effectiveThinking: thinkingOptions?.[0] ?? null,
      selectedThinkingId: thinkingOptions?.[0]?.id ?? null,
    };
  }
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return {
    effectiveThinking: selectedThinking,
    selectedThinkingId: resolvedThinkingId,
  };
}

// The thinking trigger must never silently render the lowest option when the
// configured level is not in the loaded options: a session set to "max" on a
// model that currently lists [low, medium] should show "Max", not "Low".
// Otherwise the agent looks like its model settings were changed behind the
// user's back (observed while a remote host's catalog was reloading).
export function resolveThinkingTriggerLabel(input: {
  options: ReadonlyArray<{ id: string; label: string }> | undefined;
  selectedId: string | undefined;
  unknownLabel: string;
}): string {
  const { options, selectedId, unknownLabel } = input;
  if (!options || options.length === 0) {
    return selectedId ? formatThinkingOptionLabel({ id: selectedId }) : unknownLabel;
  }
  const selected = options.find((option) => option.id === selectedId);
  if (selected) return selected.label;
  return selectedId ? formatThinkingOptionLabel({ id: selectedId }) : unknownLabel;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
  unknownModelLabel: string,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? unknownModelLabel,
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
  unknownThinkingLabel: string,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return unknownThinkingLabel;
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
    i18n.t("agentControls.model.unknown"),
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const { effectiveThinking, selectedThinkingId } = resolveThinkingSelection({
    thinkingOptions,
    resolvedThinkingId,
  });
  const displayThinking = resolveThinkingDisplay(
    effectiveThinking,
    selectedThinkingId,
    i18n.t("agentControls.thinking.unknown"),
  );

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
