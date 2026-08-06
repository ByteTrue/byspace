import type { PersistedConfig } from "../persisted-config.js";
import type { BySpaceSpeechConfig } from "../bootstrap.js";
import { resolveLocalSpeechConfig } from "./providers/local/config.js";

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function resolveSpeechConfig(params: {
  byspaceHome: string;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): BySpaceSpeechConfig {
  const local = resolveLocalSpeechConfig(params);
  return {
    sttLanguage: local.sttLanguage,
    local: local.local,
    enabled:
      parseBooleanEnv(params.env.BYSPACE_DICTATION_ENABLED) ??
      params.persisted.features?.dictation?.enabled !== false,
  };
}
