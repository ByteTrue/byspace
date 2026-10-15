import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";

export function buildDraftInitialValues(input: {
  initialSetup: WorkspaceDraftTabSetup | null;
  defaultRole?: string;
}): CreateAgentInitialValues | undefined {
  const { initialSetup, defaultRole } = input;
  if (!initialSetup && !defaultRole) return undefined;
  return {
    provider: initialSetup?.provider,
    modeId: initialSetup?.modeId,
    model: initialSetup?.model,
    thinkingOptionId: initialSetup?.thinkingOptionId,
    role: initialSetup?.role ?? defaultRole,
  };
}

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}
