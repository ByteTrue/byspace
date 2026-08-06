import path from "node:path";
import { describe, expect, it } from "vitest";

import { listSherpaOnnxModels, resolveSherpaOfflineRecognizerConfig } from "./model-catalog.js";

describe("local speech model catalog", () => {
  it("exposes FireRed and SenseVoice as allowlisted local models", () => {
    expect(listSherpaOnnxModels().map((model) => model.id)).toEqual([
      "fire-red-asr2-aed-int8",
      "sensevoice-small-int8",
    ]);
  });

  it("builds the native SenseVoice recognizer configuration", () => {
    expect(resolveSherpaOfflineRecognizerConfig("/models", "sensevoice-small-int8")).toEqual({
      model: {
        kind: "sense_voice",
        model: path.join(
          "/models",
          "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
          "model.int8.onnx",
        ),
        tokens: path.join(
          "/models",
          "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
          "tokens.txt",
        ),
        language: "auto",
        useInverseTextNormalization: 1,
      },
      numThreads: 2,
      sampleRate: 16_000,
    });
  });
});
