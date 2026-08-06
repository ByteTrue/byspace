import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BySpaceSpeechConfig } from "../bootstrap.js";
import { createSpeechService } from "./speech-runtime.js";

const MODEL_ID = "fire-red-asr2-aed-int8" as const;
const SENSEVOICE_MODEL_ID = "sensevoice-small-int8" as const;
type ModelId = typeof MODEL_ID | typeof SENSEVOICE_MODEL_ID;
const roots: string[] = [];
const mocks = vi.hoisted(() => ({
  activeSessions: false,
  ensureCalls: 0,
  ensureGate: null as Promise<void> | null,
  ensureError: null as Error | null,
  providerOptions: null as { dictationBackgroundCommitSeconds?: number } | null,
  rollbackCalls: 0,
  stageCalls: 0,
  stageGate: null as Promise<void> | null,
  ready: false,
}));

vi.mock("./providers/local/models.js", () => ({
  listLocalSpeechModels: () => [
    {
      id: "fire-red-asr2-aed-int8",
      label: "FireRedASR2-AED",
      description: "Chinese-first local transcription",
      archiveSizeBytes: 100,
    },
    {
      id: "sensevoice-small-int8",
      label: "SenseVoice Small",
      description: "Fast multilingual local transcription",
      archiveSizeBytes: 50,
      dictationBackgroundCommitSeconds: 30,
    },
  ],
  recoverSherpaOnnxModelDeletion: vi.fn(async () => undefined),
  isSherpaOnnxModelReady: vi.fn(async () => mocks.ready),
  ensureSherpaOnnxModel: vi.fn(async () => {
    mocks.ensureCalls += 1;
    await mocks.ensureGate;
    if (mocks.ensureError) throw mocks.ensureError;
    mocks.ready = true;
  }),
  stageSherpaOnnxModelDeletion: vi.fn(async () => {
    mocks.stageCalls += 1;
    await mocks.stageGate;
    return {
      commit: async () => {
        mocks.ready = false;
      },
      rollback: async () => {
        mocks.rollbackCalls += 1;
      },
    };
  }),
}));

vi.mock("./providers/local/worker-client.js", () => ({
  LocalSpeechWorkerClient: class {
    beginModelMutation() {
      if (mocks.activeSessions) {
        throw new Error("Stop the current dictation before changing models");
      }
      return () => undefined;
    }
    shutdown() {}
  },
  WorkerBackedSpeechToTextProvider: class {
    id = "local-sherpa-onnx";
    dictationBackgroundCommitSeconds: number | undefined;
    constructor(_client: unknown, options?: { dictationBackgroundCommitSeconds?: number }) {
      mocks.providerOptions = options ?? null;
      this.dictationBackgroundCommitSeconds = options?.dictationBackgroundCommitSeconds;
    }
    createSession() {
      throw new Error("not used");
    }
  },
}));

function config(modelsDir: string, selected: ModelId | null = null): BySpaceSpeechConfig {
  return {
    enabled: true,
    sttLanguage: "auto",
    local: { modelsDir, models: { dictationStt: selected } },
  };
}

async function createRuntime(selected: ModelId | null = null) {
  const root = await mkdtemp(join(tmpdir(), "byspace-speech-runtime-"));
  roots.push(root);
  return createSpeechService({
    logger: pino({ level: "silent" }),
    byspaceHome: root,
    speechConfig: config(join(root, "models"), selected),
  });
}

beforeEach(() => {
  mocks.activeSessions = false;
  mocks.ready = false;
  mocks.ensureCalls = 0;
  mocks.ensureGate = null;
  mocks.ensureError = null;
  mocks.providerOptions = null;
  mocks.stageCalls = 0;
  mocks.stageGate = null;
  mocks.rollbackCalls = 0;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createSpeechService", () => {
  it("starts without selecting or downloading a model", async () => {
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;

    expect(runtime.getReadiness().dictation.reasonCode).toBe("model_not_configured");
    expect((await runtime.listModels()).selectedModelId).toBeNull();
    expect((await runtime.listModels()).models[0]?.state).toBe("not_downloaded");
    expect(runtime.resolveDictationStt()).toBeNull();

    runtime.stop();
  });

  it("keeps a configured missing model selected without downloading it", async () => {
    const runtime = await createRuntime(MODEL_ID);
    runtime.start();
    await runtime.ready;

    expect((await runtime.listModels()).selectedModelId).toBe(MODEL_ID);
    expect(runtime.getReadiness().dictation.reasonCode).toBe("models_missing");
    expect(runtime.resolveDictationStt()).toBeNull();
    expect(mocks.ensureCalls).toBe(0);

    runtime.stop();
  });

  it("downloads, activates, and deletes the selected model on demand", async () => {
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;

    await runtime.downloadModel(MODEL_ID);
    await vi.waitFor(() => expect(runtime.resolveDictationStt()).not.toBeNull());
    expect((await runtime.listModels()).selectedModelId).toBe(MODEL_ID);
    expect(runtime.getReadiness().dictation.reasonCode).toBe("ready");

    await runtime.deleteModel(MODEL_ID);
    expect((await runtime.listModels()).selectedModelId).toBeNull();
    expect(runtime.resolveDictationStt()).toBeNull();

    runtime.stop();
  });

  it("applies the selected model's background commit cap", async () => {
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;

    await runtime.downloadModel(SENSEVOICE_MODEL_ID);
    await vi.waitFor(() => expect(runtime.resolveDictationStt()).not.toBeNull());

    expect(mocks.providerOptions).toEqual({ dictationBackgroundCommitSeconds: 30 });
    expect(runtime.resolveDictationStt()?.dictationBackgroundCommitSeconds).toBe(30);
    runtime.stop();
  });

  it("blocks model selection until an in-flight download is finalized", async () => {
    let releaseDownload!: () => void;
    mocks.ensureGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;

    await runtime.downloadModel(MODEL_ID);
    await expect(runtime.selectModel(MODEL_ID)).rejects.toThrow(
      "Wait for the model download to finish",
    );
    releaseDownload();
    await vi.waitFor(() => expect(runtime.resolveDictationStt()).not.toBeNull());
    runtime.stop();
  });

  it("does not reactivate a model after the speech service stops", async () => {
    let releaseDownload!: () => void;
    mocks.ensureGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;
    await runtime.downloadModel(MODEL_ID);

    runtime.stop();
    releaseDownload();
    await vi.waitFor(async () => {
      expect((await runtime.listModels()).models[0]?.state).toBe("ready");
    });
    expect(runtime.resolveDictationStt()).toBeNull();
  });

  it("keeps disabled dictation inactive", async () => {
    const root = await mkdtemp(join(tmpdir(), "byspace-speech-runtime-"));
    roots.push(root);
    const runtime = createSpeechService({
      logger: pino({ level: "silent" }),
      byspaceHome: root,
      speechConfig: { ...config(join(root, "models"), MODEL_ID), enabled: false },
    });

    runtime.start();
    await runtime.ready;

    expect(runtime.getReadiness().dictation).toMatchObject({
      enabled: false,
      available: false,
      reasonCode: "disabled",
    });
    await expect(runtime.downloadModel(MODEL_ID)).rejects.toThrow("Dictation is disabled");
    runtime.stop();
  });

  it("preserves an active dictation session when selecting or deleting", async () => {
    mocks.ready = true;
    const runtime = await createRuntime(MODEL_ID);
    runtime.start();
    await runtime.ready;
    mocks.activeSessions = true;

    await expect(runtime.selectModel(MODEL_ID)).rejects.toThrow("Stop the current dictation");
    await expect(runtime.deleteModel(MODEL_ID)).rejects.toThrow("Stop the current dictation");
    expect(runtime.resolveDictationStt()).not.toBeNull();
    expect((await runtime.listModels()).selectedModelId).toBe(MODEL_ID);

    runtime.stop();
  });

  it("serializes model lifecycle mutations", async () => {
    mocks.ready = true;
    let releaseStage!: () => void;
    mocks.stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });
    const runtime = await createRuntime(MODEL_ID);
    runtime.start();
    await runtime.ready;

    const deletion = runtime.deleteModel(MODEL_ID);
    await vi.waitFor(() => expect(mocks.stageCalls).toBe(1));
    let selectionSettled = false;
    const selection = runtime.selectModel(MODEL_ID);
    void selection.then(
      () => {
        selectionSettled = true;
        return undefined;
      },
      () => {
        selectionSettled = true;
        return undefined;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selectionSettled).toBe(false);

    releaseStage();
    await deletion;
    await expect(selection).rejects.toThrow("Download this model before selecting it");
    runtime.stop();
  });

  it("does not switch runtime state when selection persistence fails", async () => {
    mocks.ready = true;
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;
    const root = roots.at(-1);
    if (!root) throw new Error("Missing test root");
    await mkdir(join(root, "config.json"));

    await expect(runtime.selectModel(MODEL_ID)).rejects.toThrow();
    expect((await runtime.listModels()).selectedModelId).toBeNull();
    expect(runtime.resolveDictationStt()).toBeNull();
    runtime.stop();
  });

  it("rolls back staged deletion when clearing persisted selection fails", async () => {
    mocks.ready = true;
    const runtime = await createRuntime(MODEL_ID);
    runtime.start();
    await runtime.ready;
    const root = roots.at(-1);
    if (!root) throw new Error("Missing test root");
    await mkdir(join(root, "config.json"));

    await expect(runtime.deleteModel(MODEL_ID)).rejects.toThrow();
    expect(mocks.rollbackCalls).toBe(1);
    expect((await runtime.listModels()).selectedModelId).toBe(MODEL_ID);
    expect(runtime.resolveDictationStt()).not.toBeNull();
    runtime.stop();
  });

  it("surfaces a failed download and allows retry", async () => {
    mocks.ensureError = new Error("network unavailable");
    const runtime = await createRuntime();
    runtime.start();
    await runtime.ready;

    await runtime.downloadModel(MODEL_ID);
    await vi.waitFor(async () => {
      expect((await runtime.listModels()).models[0]).toMatchObject({
        state: "error",
        error: "network unavailable",
      });
    });

    mocks.ensureError = null;
    await runtime.downloadModel(MODEL_ID);
    await vi.waitFor(() => expect(runtime.resolveDictationStt()).not.toBeNull());
    expect(mocks.ensureCalls).toBe(2);

    runtime.stop();
  });
});
