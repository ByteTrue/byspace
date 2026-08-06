import { existsSync } from "node:fs";
import type pino from "pino";
import { loadSherpaOnnxNode } from "./sherpa-onnx-node-loader.js";

export type SherpaOfflineRecognizerModel =
  | {
      kind: "fire_red_asr";
      encoder: string;
      decoder: string;
      tokens: string;
    }
  | {
      kind: "sense_voice";
      model: string;
      tokens: string;
      language: "auto";
      useInverseTextNormalization: 1;
    };

export interface SherpaOfflineRecognizerConfig {
  model: SherpaOfflineRecognizerModel;
  numThreads?: number;
  sampleRate?: number;
}

interface SherpaOfflineRecognizerNative {
  config?: { featConfig?: { sampleRate?: number } };
  createStream: () => unknown;
  decode: (stream: unknown) => void;
  getResult: (stream: unknown) => { text?: string } | string | undefined;
  free?: () => void;
}

interface SherpaOfflineStreamNative {
  acceptWaveform: ((arg: { samples: Float32Array; sampleRate: number }) => void) &
    ((sampleRate: number, samples: Float32Array) => void);
  free?: () => void;
}

function requirePath(filePath: string, label: string): void {
  if (!existsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`);
}

type SherpaOfflineNativeModelConfig =
  | { fireRedAsr: { encoder: string; decoder: string }; tokens: string }
  | {
      senseVoice: { model: string; language: "auto"; useInverseTextNormalization: 1 };
      tokens: string;
    };

function buildNativeModelConfig(
  model: SherpaOfflineRecognizerModel,
): SherpaOfflineNativeModelConfig {
  requirePath(model.tokens, "tokens");
  if (model.kind === "fire_red_asr") {
    requirePath(model.encoder, "encoder");
    requirePath(model.decoder, "decoder");
    return {
      fireRedAsr: { encoder: model.encoder, decoder: model.decoder },
      tokens: model.tokens,
    };
  }

  requirePath(model.model, "model");
  return {
    senseVoice: {
      model: model.model,
      language: model.language,
      useInverseTextNormalization: model.useInverseTextNormalization,
    },
    tokens: model.tokens,
  };
}

export class SherpaOfflineRecognizerEngine {
  public readonly recognizer: SherpaOfflineRecognizerNative;
  public readonly sampleRate: number;
  public readonly modelKind: SherpaOfflineRecognizerModel["kind"];
  private readonly logger: pino.Logger;

  constructor(config: SherpaOfflineRecognizerConfig, logger: pino.Logger) {
    this.logger = logger.child({ module: "speech", provider: "local", component: "recognizer" });
    const { model } = config;
    const modelConfig = buildNativeModelConfig(model);
    const recognizerConfig = {
      featConfig: { sampleRate: config.sampleRate ?? 16_000, featureDim: 80 },
      modelConfig: {
        ...modelConfig,
        numThreads: config.numThreads ?? 2,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
      maxActivePaths: 4,
    };
    const sherpa = loadSherpaOnnxNode() as unknown as {
      OfflineRecognizer: new (value: unknown) => SherpaOfflineRecognizerNative;
    };
    this.recognizer = new sherpa.OfflineRecognizer(recognizerConfig);
    this.sampleRate = this.recognizer.config?.featConfig?.sampleRate ?? 16_000;
    this.modelKind = model.kind;
    this.logger.info({ model: model.kind, sampleRate: this.sampleRate }, "Recognizer initialized");
  }

  createStream(): SherpaOfflineStreamNative {
    return this.recognizer.createStream() as SherpaOfflineStreamNative;
  }

  acceptWaveform(
    stream: SherpaOfflineStreamNative,
    sampleRate: number,
    samples: Float32Array,
  ): void {
    if (stream.acceptWaveform.length <= 1) stream.acceptWaveform({ samples, sampleRate });
    else stream.acceptWaveform(sampleRate, samples);
  }

  free(): void {
    try {
      this.recognizer.free?.();
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to free recognizer");
    }
  }
}
