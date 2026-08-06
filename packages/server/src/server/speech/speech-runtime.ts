import path from "node:path";
import type {
  SpeechModelPayload,
  SpeechModelId,
  SpeechModelState,
} from "@bytetrue/byspace-protocol/messages";
import type { Logger } from "pino";
import type { BySpaceSpeechConfig } from "../bootstrap.js";
import { loadPersistedConfig, savePersistedConfig } from "../persisted-config.js";
import {
  ensureSherpaOnnxModel,
  isSherpaOnnxModelReady,
  listLocalSpeechModels,
  recoverSherpaOnnxModelDeletion,
  stageSherpaOnnxModelDeletion,
  type LocalSttModelId,
} from "./providers/local/models.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
} from "./providers/local/worker-client.js";
import type { SpeechToTextProvider } from "./speech-provider.js";

export type SpeechReadinessReasonCode =
  | "ready"
  | "disabled"
  | "model_not_configured"
  | "models_missing"
  | "model_download_in_progress"
  | "model_download_failed";

export interface SpeechReadinessState {
  enabled: boolean;
  available: boolean;
  reasonCode: SpeechReadinessReasonCode;
  message: string;
  retryable: boolean;
  missingModelIds: LocalSttModelId[];
}

export interface SpeechReadinessSnapshot {
  generatedAt: string;
  requiredLocalModelIds: LocalSttModelId[];
  missingLocalModelIds: LocalSttModelId[];
  download: { inProgress: boolean; error: string | null };
  dictation: SpeechReadinessState;
}

export interface SpeechService {
  resolveDictationStt: () => SpeechToTextProvider | null;
  resolveDictationSttLanguage: () => string;
  getReadiness: () => SpeechReadinessSnapshot;
  onReadinessChange: (listener: (snapshot: SpeechReadinessSnapshot) => void) => () => void;
  listModels: () => Promise<{
    selectedModelId: SpeechModelId | null;
    models: SpeechModelPayload[];
  }>;
  downloadModel: (modelId: SpeechModelId) => Promise<void>;
  selectModel: (modelId: SpeechModelId) => Promise<void>;
  deleteModel: (modelId: SpeechModelId) => Promise<void>;
  start: () => void;
  stop: () => void;
  ready: Promise<void>;
}

export function createSpeechService(params: {
  logger: Logger;
  byspaceHome: string;
  speechConfig?: BySpaceSpeechConfig;
}): SpeechService {
  const logger = params.logger.child({ module: "dictation" });
  const modelsDir =
    params.speechConfig?.local?.modelsDir ??
    path.join(params.byspaceHome, "models", "local-speech");

  const dictationEnabled = params.speechConfig?.enabled ?? true;
  let selectedModelId = dictationEnabled
    ? (params.speechConfig?.local?.models.dictationStt ?? null)
    : null;
  let client: LocalSpeechWorkerClient | null = null;
  let provider: SpeechToTextProvider | null = null;
  let started = false;
  let stopped = false;
  const jobs = new Map<LocalSttModelId, { state: "downloading" | "error"; error?: string }>();
  const listeners = new Set<(snapshot: SpeechReadinessSnapshot) => void>();
  let lastFingerprint = "";
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let mutationTail = Promise.resolve();
  const runMutation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const normalizeModelId = (modelId: SpeechModelId): LocalSttModelId => {
    const model = listLocalSpeechModels().find((candidate) => candidate.id === modelId);
    if (!model) throw new Error(`Unknown dictation model: ${modelId}`);
    return model.id;
  };

  const assertEnabled = (): void => {
    if (!dictationEnabled) throw new Error("Dictation is disabled in daemon config");
  };

  const persistSelection = (modelId: LocalSttModelId | null): void => {
    const config = loadPersistedConfig(params.byspaceHome, logger);
    const current = config.features?.dictation;
    savePersistedConfig(
      params.byspaceHome,
      {
        ...config,
        features: {
          ...config.features,
          dictation: {
            ...current,
            enabled: true,
            stt: modelId ? { model: modelId } : undefined,
          },
        },
      },
      logger,
    );
  };

  const deactivate = (): void => {
    provider = null;
    client?.shutdown();
    client = null;
  };

  const activate = async (
    modelId: LocalSttModelId,
    persist = true,
    mutationHeld = false,
  ): Promise<void> => {
    if (!(await isSherpaOnnxModelReady(modelsDir, modelId))) {
      throw new Error("Download this model before selecting it");
    }
    const releaseMutation = mutationHeld
      ? () => undefined
      : (client?.beginModelMutation() ?? (() => undefined));
    try {
      const nextClient = new LocalSpeechWorkerClient({
        logger,
        config: { modelsDir, dictationSttModel: modelId },
      });
      const modelSpec = listLocalSpeechModels().find(({ id }) => id === modelId);
      const nextProvider = new WorkerBackedSpeechToTextProvider(nextClient, {
        dictationBackgroundCommitSeconds: modelSpec?.dictationBackgroundCommitSeconds,
      });
      if (persist) persistSelection(modelId);
      deactivate();
      client = nextClient;
      provider = nextProvider;
      selectedModelId = modelId;
      publish();
    } finally {
      releaseMutation();
    }
  };

  const modelState = async (
    modelId: LocalSttModelId,
  ): Promise<{ state: SpeechModelState; error?: string }> => {
    const job = jobs.get(modelId);
    if (job?.state === "downloading") return { state: "downloading" };
    if (job?.state === "error") {
      return { state: "error", error: job.error ?? "Download failed" };
    }
    return {
      state: (await isSherpaOnnxModelReady(modelsDir, modelId)) ? "ready" : "not_downloaded",
    };
  };

  const listModels = async (): Promise<{
    selectedModelId: SpeechModelId | null;
    models: SpeechModelPayload[];
  }> => ({
    selectedModelId,
    models: await Promise.all(
      listLocalSpeechModels().map(async (model) =>
        Object.assign(
          {
            id: model.id,
            label: model.label,
            description: model.description,
            sizeBytes: model.archiveSizeBytes,
          },
          await modelState(model.id),
        ),
      ),
    ),
  });

  const dictationState = (): SpeechReadinessState => {
    if (!dictationEnabled) {
      return {
        enabled: false,
        available: false,
        reasonCode: "disabled",
        message: "Dictation is disabled in daemon config.",
        retryable: false,
        missingModelIds: [],
      };
    }
    if (!selectedModelId) {
      return {
        enabled: true,
        available: false,
        reasonCode: "model_not_configured",
        message: "Choose and download a dictation model in Host settings.",
        retryable: true,
        missingModelIds: [],
      };
    }
    const job = jobs.get(selectedModelId);
    if (job?.state === "downloading") {
      return {
        enabled: true,
        available: false,
        reasonCode: "model_download_in_progress",
        message: "The selected dictation model is downloading.",
        retryable: true,
        missingModelIds: [selectedModelId],
      };
    }
    if (job?.state === "error") {
      return {
        enabled: true,
        available: false,
        reasonCode: "model_download_failed",
        message: job.error ?? "The dictation model download failed.",
        retryable: true,
        missingModelIds: [selectedModelId],
      };
    }
    if (!provider) {
      return {
        enabled: true,
        available: false,
        reasonCode: "models_missing",
        message: "The selected dictation model is not installed.",
        retryable: true,
        missingModelIds: [selectedModelId],
      };
    }
    return {
      enabled: true,
      available: true,
      reasonCode: "ready",
      message: "Dictation is ready.",
      retryable: false,
      missingModelIds: [],
    };
  };

  const snapshot = (): SpeechReadinessSnapshot => {
    const dictation = dictationState();
    const currentJob = selectedModelId ? jobs.get(selectedModelId) : undefined;
    return {
      generatedAt: new Date().toISOString(),
      requiredLocalModelIds: selectedModelId ? [selectedModelId] : [],
      missingLocalModelIds: dictation.missingModelIds,
      download: {
        inProgress: currentJob?.state === "downloading",
        error: currentJob?.state === "error" ? (currentJob.error ?? "Download failed") : null,
      },
      dictation,
    };
  };

  const publish = (): void => {
    const value = snapshot();
    const fingerprint = JSON.stringify({ ...value, generatedAt: "" });
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    for (const listener of listeners) listener(value);
  };

  const downloadModel = (rawModelId: SpeechModelId): Promise<void> =>
    runMutation(async () => {
      assertEnabled();
      const modelId = normalizeModelId(rawModelId);
      if (jobs.get(modelId)?.state === "downloading") return;
      if (await isSherpaOnnxModelReady(modelsDir, modelId)) {
        await activate(modelId);
        return;
      }

      const releaseMutation = client?.beginModelMutation() ?? (() => undefined);
      try {
        persistSelection(modelId);
        selectedModelId = modelId;
        jobs.set(modelId, { state: "downloading" });
        publish();
      } catch (error) {
        releaseMutation();
        throw error;
      }

      void ensureSherpaOnnxModel({ modelsDir, modelId, logger })
        .then(
          () =>
            runMutation(async () => {
              try {
                jobs.delete(modelId);
                if (!stopped && selectedModelId === modelId) {
                  await activate(modelId, false, true);
                } else {
                  publish();
                }
              } finally {
                releaseMutation();
              }
            }),
          (error: unknown) =>
            runMutation(async () => {
              try {
                jobs.set(modelId, {
                  state: "error",
                  error: error instanceof Error ? error.message : String(error),
                });
                publish();
              } finally {
                releaseMutation();
              }
            }),
        )
        .catch((error: unknown) => {
          logger.error({ err: error, modelId }, "Failed to finalize speech model download");
        });
    });

  const selectModel = (rawModelId: SpeechModelId): Promise<void> =>
    runMutation(async () => {
      assertEnabled();
      const modelId = normalizeModelId(rawModelId);
      if (jobs.get(modelId)?.state === "downloading") {
        throw new Error("Wait for the model download to finish");
      }
      await activate(modelId);
    });

  const deleteModel = (rawModelId: SpeechModelId): Promise<void> =>
    runMutation(async () => {
      const modelId = normalizeModelId(rawModelId);
      if (jobs.get(modelId)?.state === "downloading") {
        throw new Error("Wait for the model download to finish");
      }
      const isSelected = selectedModelId === modelId;
      const releaseMutation = client?.beginModelMutation() ?? (() => undefined);
      try {
        const deletion = await stageSherpaOnnxModelDeletion(modelsDir, modelId);
        if (isSelected) {
          try {
            persistSelection(null);
          } catch (error) {
            await deletion.rollback();
            throw error;
          }
          deactivate();
          selectedModelId = null;
        }
        jobs.delete(modelId);
        await deletion.commit().catch((error: unknown) => {
          logger.warn({ err: error, modelId }, "Failed to clean up deleted speech model files");
        });
        publish();
      } finally {
        releaseMutation();
      }
    });

  const start = (): void => {
    if (started || stopped) return;
    started = true;
    void runMutation(async () => {
      try {
        await Promise.all(
          listLocalSpeechModels().map((model) =>
            recoverSherpaOnnxModelDeletion(modelsDir, model.id, selectedModelId === model.id),
          ),
        );
        if (selectedModelId && (await isSherpaOnnxModelReady(modelsDir, selectedModelId))) {
          await activate(selectedModelId, false);
        }
        publish();
        resolveReady();
      } catch (error) {
        rejectReady(error);
      }
    });
  };

  return {
    resolveDictationStt: () => provider,
    resolveDictationSttLanguage: () => params.speechConfig?.sttLanguage ?? "auto",
    getReadiness: snapshot,
    onReadinessChange(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    listModels,
    downloadModel,
    selectModel,
    deleteModel,
    start,
    stop() {
      stopped = true;
      deactivate();
    },
    ready,
  };
}
