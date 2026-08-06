const LOCAL_SPEECH_ENV_KEYS = [
  "BYSPACE_DICTATION_ENABLED",
  "BYSPACE_LOCAL_MODELS_DIR",
  "BYSPACE_DICTATION_LOCAL_STT_MODEL",
] as const;

const DISABLED_E2E_SPEECH_ENV = {
  BYSPACE_DICTATION_ENABLED: "0",
} as const;

function withoutConfiguredSpeech(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of LOCAL_SPEECH_ENV_KEYS) delete next[key];
  return next;
}

export function withUnconfiguredE2ESpeechEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withoutConfiguredSpeech(env);
}

export function withDisabledE2ESpeechEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...withoutConfiguredSpeech(env), ...DISABLED_E2E_SPEECH_ENV };
}
