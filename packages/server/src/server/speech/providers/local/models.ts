import {
  ensureSherpaOnnxModel,
  getSherpaOnnxModelDir,
  isSherpaOnnxModelReady,
  recoverSherpaOnnxModelDeletion,
  stageSherpaOnnxModelDeletion,
} from "./sherpa/model-downloader.js";
import {
  LocalSttModelIdSchema,
  listSherpaOnnxModels,
  type LocalSpeechModelId,
  type LocalSttModelId,
} from "./sherpa/model-catalog.js";

export { LocalSttModelIdSchema, type LocalSpeechModelId, type LocalSttModelId };

export type LocalSpeechModelSpec = ReturnType<typeof listSherpaOnnxModels>[number];

export function listLocalSpeechModels(): LocalSpeechModelSpec[] {
  return listSherpaOnnxModels();
}

export function getLocalSpeechModelDir(modelsDir: string, modelId: LocalSpeechModelId): string {
  return getSherpaOnnxModelDir(modelsDir, modelId);
}

export async function ensureLocalSpeechModels(options: {
  modelsDir: string;
  modelIds: LocalSpeechModelId[];
  logger: import("pino").Logger;
}): Promise<void> {
  await Promise.all(
    [...new Set(options.modelIds)].map((modelId) => ensureSherpaOnnxModel({ ...options, modelId })),
  );
}

export {
  ensureSherpaOnnxModel,
  isSherpaOnnxModelReady,
  recoverSherpaOnnxModelDeletion,
  stageSherpaOnnxModelDeletion,
};
