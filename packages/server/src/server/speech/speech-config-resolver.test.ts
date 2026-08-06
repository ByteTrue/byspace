import path from "node:path";
import { describe, expect, test } from "vitest";
import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveSpeechConfig } from "./speech-config-resolver.js";

describe("resolveSpeechConfig", () => {
  test("starts enabled but without selecting a model", () => {
    const byspaceHome = "/tmp/byspace-home";
    const result = resolveSpeechConfig({
      byspaceHome,
      env: {} as NodeJS.ProcessEnv,
      persisted: PersistedConfigSchema.parse({}),
    });

    expect(result).toEqual({
      enabled: true,
      sttLanguage: "auto",
      local: {
        modelsDir: path.join(byspaceHome, "models", "local-speech"),
        models: { dictationStt: null },
      },
    });
  });

  test("resolves the selected local model and automatic language", () => {
    const result = resolveSpeechConfig({
      byspaceHome: "/tmp/byspace-home",
      env: { BYSPACE_LOCAL_MODELS_DIR: "/tmp/models" } as NodeJS.ProcessEnv,
      persisted: PersistedConfigSchema.parse({
        features: {
          dictation: {
            stt: { model: "fire-red-asr2-aed-int8" },
          },
        },
      }),
    });

    expect(result.local).toEqual({
      modelsDir: "/tmp/models",
      models: { dictationStt: "fire-red-asr2-aed-int8" },
    });
    expect(result.sttLanguage).toBe("auto");
  });

  test("honors disabled dictation", () => {
    const result = resolveSpeechConfig({
      byspaceHome: "/tmp/byspace-home",
      env: {} as NodeJS.ProcessEnv,
      persisted: PersistedConfigSchema.parse({
        features: { dictation: { enabled: false } },
      }),
    });

    expect(result.enabled).toBe(false);
    expect(result.local?.models.dictationStt).toBeNull();
  });

  test("honors the environment override", () => {
    const result = resolveSpeechConfig({
      byspaceHome: "/tmp/byspace-home",
      env: { BYSPACE_DICTATION_ENABLED: "0" } as NodeJS.ProcessEnv,
      persisted: PersistedConfigSchema.parse({
        features: { dictation: { enabled: true } },
      }),
    });

    expect(result.enabled).toBe(false);
  });
});
