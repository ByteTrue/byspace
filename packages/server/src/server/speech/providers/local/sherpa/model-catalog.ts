import path from "node:path";
import { z } from "zod";

export type SherpaOnnxRuntime =
  | { kind: "fire_red_asr"; encoder: string; decoder: string; tokens: string }
  | {
      kind: "sense_voice";
      model: string;
      tokens: string;
      language: "auto";
      useInverseTextNormalization: 1;
    };

export interface SherpaOnnxCatalogEntry {
  kind: "stt-offline";
  label: string;
  description: string;
  archiveUrl: string;
  archiveSizeBytes: number;
  archiveSha256: string;
  extractedDir: string;
  requiredFiles: string[];
  dictationBackgroundCommitSeconds?: number;
  runtime: SherpaOnnxRuntime;
}

export const SHERPA_ONNX_MODEL_CATALOG = {
  "fire-red-asr2-aed-int8": {
    kind: "stt-offline",
    label: "FireRedASR2-AED",
    description:
      "Mandarin-first; supports English, Mandarin-English code-switching, and 20+ Chinese dialects.",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2",
    archiveSizeBytes: 838_589_068,
    archiveSha256: "43015b3f1643a5688b4821e8ed323473d38b798c4ec291471fe00df1bcfc4f1c",
    extractedDir: "sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26",
    requiredFiles: ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"],
    runtime: {
      kind: "fire_red_asr",
      encoder: "encoder.int8.onnx",
      decoder: "decoder.int8.onnx",
      tokens: "tokens.txt",
    },
  },
  "sensevoice-small-int8": {
    kind: "stt-offline",
    label: "SenseVoice Small",
    description:
      "Alibaba FunASR SenseVoice Small; fast Mandarin, English, Cantonese, Japanese, and Korean recognition with punctuation.",
    archiveUrl:
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
    archiveSizeBytes: 163_002_883,
    archiveSha256: "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e",
    extractedDir: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
    requiredFiles: ["model.int8.onnx", "tokens.txt", "LICENSE"],
    dictationBackgroundCommitSeconds: 30,
    runtime: {
      kind: "sense_voice",
      model: "model.int8.onnx",
      tokens: "tokens.txt",
      language: "auto",
      useInverseTextNormalization: 1,
    },
  },
} as const satisfies Record<string, SherpaOnnxCatalogEntry>;

export type SherpaOnnxModelId = keyof typeof SHERPA_ONNX_MODEL_CATALOG;
export type LocalSpeechModelId = SherpaOnnxModelId;
export type LocalSttModelId = SherpaOnnxModelId;

export const LOCAL_STT_MODEL_IDS = Object.keys(SHERPA_ONNX_MODEL_CATALOG) as LocalSttModelId[];

export const LocalSttModelIdSchema = z.enum(
  LOCAL_STT_MODEL_IDS as [LocalSttModelId, ...LocalSttModelId[]],
);

export type SherpaOnnxModelSpec = SherpaOnnxCatalogEntry & { id: SherpaOnnxModelId };

export function listSherpaOnnxModels(): SherpaOnnxModelSpec[] {
  return LOCAL_STT_MODEL_IDS.map((id) => Object.assign({ id }, SHERPA_ONNX_MODEL_CATALOG[id]));
}

export function getSherpaOnnxModelSpec(id: SherpaOnnxModelId): SherpaOnnxModelSpec {
  const spec = SHERPA_ONNX_MODEL_CATALOG[id];
  if (!spec) throw new Error(`Unknown local speech model id: ${id}`);
  return { id, ...spec };
}

export function resolveSherpaOfflineRecognizerConfig(modelsDir: string, id: LocalSttModelId) {
  const spec = getSherpaOnnxModelSpec(id);
  const modelDir = path.join(modelsDir, spec.extractedDir);
  const runtime = spec.runtime;
  const model =
    runtime.kind === "fire_red_asr"
      ? {
          kind: runtime.kind,
          encoder: path.join(modelDir, runtime.encoder),
          decoder: path.join(modelDir, runtime.decoder),
          tokens: path.join(modelDir, runtime.tokens),
        }
      : {
          kind: runtime.kind,
          model: path.join(modelDir, runtime.model),
          tokens: path.join(modelDir, runtime.tokens),
          language: runtime.language,
          useInverseTextNormalization: runtime.useInverseTextNormalization,
        };
  return { model, numThreads: 2, sampleRate: 16_000 } as const;
}
