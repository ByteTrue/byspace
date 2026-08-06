import path from "node:path";
import type { PersistedConfig } from "../../../persisted-config.js";
import { LocalSttModelIdSchema, type LocalSttModelId } from "./models.js";

export interface LocalSpeechModelConfig {
  dictationStt: LocalSttModelId | null;
}

export interface LocalSpeechProviderConfig {
  modelsDir: string;
  models: LocalSpeechModelConfig;
}

export interface ResolvedLocalSpeechConfig {
  local: LocalSpeechProviderConfig;
  sttLanguage: string;
}

export type { LocalSpeechModelId, LocalSttModelId } from "./models.js";

function resolveSelectedModel(value: string | undefined): LocalSttModelId | null {
  if (!value?.trim()) return null;
  const parsed = LocalSttModelIdSchema.safeParse(value.trim());
  // COMPAT(legacySpeechModels): added in v0.5.0, remove after 2027-02-04.
  // Removed model IDs remain parseable in persisted config but no longer auto-activate.
  return parsed.success ? parsed.data : null;
}

export function resolveLocalSpeechConfig(params: {
  byspaceHome: string;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): ResolvedLocalSpeechConfig {
  const modelsDir =
    params.env.BYSPACE_LOCAL_MODELS_DIR?.trim() ||
    params.persisted.providers?.local?.modelsDir?.trim() ||
    path.join(params.byspaceHome, "models", "local-speech");
  const selectedModel = resolveSelectedModel(
    params.env.BYSPACE_DICTATION_LOCAL_STT_MODEL ??
      params.persisted.features?.dictation?.stt?.model,
  );
  return {
    local: {
      modelsDir,
      models: { dictationStt: selectedModel },
    },
    sttLanguage: "auto",
  };
}
