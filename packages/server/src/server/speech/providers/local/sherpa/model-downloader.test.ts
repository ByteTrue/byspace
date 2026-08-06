import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";

import {
  downloadToFile,
  ensureSherpaOnnxModel,
  getSherpaOnnxModelDir,
  recoverSherpaOnnxModelDeletion,
  stageSherpaOnnxModelDeletion,
  verifyModelArchive,
} from "./model-downloader.js";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "byspace-speech-models-"));
}

function writeReadyModel(modelDir: string): void {
  mkdirSync(modelDir, { recursive: true });
  writeFileSync(path.join(modelDir, "encoder.int8.onnx"), "x");
  writeFileSync(path.join(modelDir, "decoder.int8.onnx"), "x");
  writeFileSync(path.join(modelDir, "tokens.txt"), "x");
}

const logger = pino({ level: "silent" });

describe("sherpa model downloader", () => {
  test("verifyModelArchive rejects truncated and modified archives", async () => {
    const archivePath = path.join(makeTmpDir(), "model.tar.bz2");
    writeFileSync(archivePath, "model");
    const digest = createHash("sha256").update("model").digest("hex");

    await expect(verifyModelArchive(archivePath, 5, digest)).resolves.toBeUndefined();
    await expect(verifyModelArchive(archivePath, 6, digest)).rejects.toThrow("size mismatch");
    await expect(verifyModelArchive(archivePath, 5, "0".repeat(64))).rejects.toThrow(
      "checksum mismatch",
    );
  });

  test("stops chunked downloads before they exceed the catalog size", async () => {
    const outputPath = path.join(makeTmpDir(), "model.tar.bz2");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("123456")),
    );
    try {
      await expect(downloadToFile("https://example.test/model", outputPath, 5)).rejects.toThrow(
        "exceeds expected size",
      );
      expect(existsSync(outputPath)).toBe(false);
      expect(existsSync(`${outputPath}.partial`)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("getSherpaOnnxModelDir maps modelId to extractedDir", () => {
    const modelsDir = "/tmp/models";
    expect(getSherpaOnnxModelDir(modelsDir, "fire-red-asr2-aed-int8")).toContain(
      "sherpa-onnx-fire-red-asr2-zh_en-int8",
    );
  });

  test("ensureSherpaOnnxModel succeeds without downloading when files exist", async () => {
    const modelsDir = makeTmpDir();
    const modelDir = getSherpaOnnxModelDir(modelsDir, "fire-red-asr2-aed-int8");

    writeReadyModel(modelDir);

    const out = await ensureSherpaOnnxModel({
      modelsDir,
      modelId: "fire-red-asr2-aed-int8",
      logger,
    });

    expect(out).toBe(modelDir);
  });
  test("recovers an interrupted install before checking readiness", async () => {
    const modelsDir = makeTmpDir();
    const modelDir = getSherpaOnnxModelDir(modelsDir, "fire-red-asr2-aed-int8");
    writeReadyModel(`${modelDir}.backup`);

    await expect(
      ensureSherpaOnnxModel({ modelsDir, modelId: "fire-red-asr2-aed-int8", logger }),
    ).resolves.toBe(modelDir);
    expect(existsSync(modelDir)).toBe(true);
    expect(existsSync(`${modelDir}.backup`)).toBe(false);
  });

  test("staged deletion rolls back and recovers after interruption", async () => {
    const modelsDir = makeTmpDir();
    const modelDir = getSherpaOnnxModelDir(modelsDir, "fire-red-asr2-aed-int8");
    writeReadyModel(modelDir);

    const first = await stageSherpaOnnxModelDeletion(modelsDir, "fire-red-asr2-aed-int8");
    expect(existsSync(modelDir)).toBe(false);
    await first.rollback();
    expect(existsSync(modelDir)).toBe(true);

    await stageSherpaOnnxModelDeletion(modelsDir, "fire-red-asr2-aed-int8");
    await recoverSherpaOnnxModelDeletion(modelsDir, "fire-red-asr2-aed-int8", true);
    expect(existsSync(modelDir)).toBe(true);

    await stageSherpaOnnxModelDeletion(modelsDir, "fire-red-asr2-aed-int8");
    await recoverSherpaOnnxModelDeletion(modelsDir, "fire-red-asr2-aed-int8", false);
    expect(existsSync(modelDir)).toBe(false);
    expect(existsSync(`${modelDir}.deleting`)).toBe(false);
  });
});
