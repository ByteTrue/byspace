import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type pino from "pino";

import { getSherpaOnnxModelSpec, type SherpaOnnxModelId } from "./model-catalog.js";
import { spawnProcess } from "../../../../../utils/spawn.js";

export function getSherpaOnnxModelDir(modelsDir: string, modelId: SherpaOnnxModelId): string {
  return path.join(modelsDir, getSherpaOnnxModelSpec(modelId).extractedDir);
}

async function pathIsPresent(filePath: string): Promise<boolean> {
  try {
    const value = await stat(filePath);
    return value.isDirectory() || (value.isFile() && value.size > 0);
  } catch {
    return false;
  }
}

export async function isSherpaOnnxModelReady(
  modelsDir: string,
  modelId: SherpaOnnxModelId,
): Promise<boolean> {
  const spec = getSherpaOnnxModelSpec(modelId);
  const modelDir = getSherpaOnnxModelDir(modelsDir, modelId);
  const files = await Promise.all(
    spec.requiredFiles.map((file) => pathIsPresent(path.join(modelDir, file))),
  );
  return files.every(Boolean);
}

export async function downloadToFile(
  url: string,
  outputPath: string,
  maxBytes: number,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error("Failed to download model: missing response body");
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new Error(`Downloaded model exceeds expected size of ${maxBytes} bytes`);
  }

  const partialPath = `${outputPath}.partial`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  // The fetch stream and Node stream declarations differ even though the runtime objects interoperate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = Readable.fromWeb(response.body as any);
  let downloadedBytes = 0;
  const sizeLimit = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      downloadedBytes += chunk.byteLength;
      if (downloadedBytes > maxBytes) {
        callback(new Error(`Downloaded model exceeds expected size of ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(input, sizeLimit, createWriteStream(partialPath));
    await rename(partialPath, outputPath);
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyModelArchive(
  archivePath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
): Promise<void> {
  const archiveStat = await stat(archivePath);
  if (archiveStat.size !== expectedSizeBytes) {
    throw new Error(
      `Downloaded model size mismatch: expected ${expectedSizeBytes}, got ${archiveStat.size}`,
    );
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expectedSha256) throw new Error("Downloaded model checksum mismatch");
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess("tar", ["xf", archivePath, "-C", destination], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });
}

export async function ensureSherpaOnnxModel(options: {
  modelsDir: string;
  modelId: SherpaOnnxModelId;
  logger: pino.Logger;
}): Promise<string> {
  const { modelsDir, modelId } = options;
  const spec = getSherpaOnnxModelSpec(modelId);
  const modelDir = getSherpaOnnxModelDir(modelsDir, modelId);
  const backupDir = `${modelDir}.backup`;
  if (await pathIsPresent(modelDir)) {
    await rm(backupDir, { recursive: true, force: true });
  } else if (await pathIsPresent(backupDir)) {
    await rename(backupDir, modelDir);
  }
  if (await isSherpaOnnxModelReady(modelsDir, modelId)) return modelDir;

  const logger = options.logger.child({ module: "speech-models", modelId });
  const downloadsDir = path.join(modelsDir, ".downloads");
  const archivePath = path.join(downloadsDir, path.basename(new URL(spec.archiveUrl).pathname));
  const installRoot = path.join(modelsDir, `.install-${modelId}-${Date.now()}`);

  try {
    logger.info({ sizeBytes: spec.archiveSizeBytes }, "Downloading speech model");
    if (!(await pathIsPresent(archivePath))) {
      await downloadToFile(spec.archiveUrl, archivePath, spec.archiveSizeBytes);
    }
    await verifyModelArchive(archivePath, spec.archiveSizeBytes, spec.archiveSha256);
    await extractArchive(archivePath, installRoot);

    const extractedDir = path.join(installRoot, spec.extractedDir);
    const required = await Promise.all(
      spec.requiredFiles.map((file) => pathIsPresent(path.join(extractedDir, file))),
    );
    if (!required.every(Boolean)) throw new Error("Downloaded model is missing required files");

    await rm(backupDir, { recursive: true, force: true });
    if (await pathIsPresent(modelDir)) await rename(modelDir, backupDir);
    try {
      await rename(extractedDir, modelDir);
    } catch (error) {
      if (!(await pathIsPresent(modelDir)) && (await pathIsPresent(backupDir))) {
        await rename(backupDir, modelDir);
      }
      throw error;
    }
    await rm(backupDir, { recursive: true, force: true });
    logger.info({ modelDir }, "Speech model installed");
    return modelDir;
  } finally {
    await rm(installRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(archivePath, { force: true }).catch(() => undefined);
  }
}

export async function recoverSherpaOnnxModelDeletion(
  modelsDir: string,
  modelId: SherpaOnnxModelId,
  selected: boolean,
): Promise<void> {
  const modelDir = getSherpaOnnxModelDir(modelsDir, modelId);
  const stagedDir = `${modelDir}.deleting`;
  if (!(await pathIsPresent(stagedDir))) return;
  if (selected && !(await pathIsPresent(modelDir))) {
    await rename(stagedDir, modelDir);
  } else {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

export interface StagedSherpaOnnxModelDeletion {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

export async function stageSherpaOnnxModelDeletion(
  modelsDir: string,
  modelId: SherpaOnnxModelId,
): Promise<StagedSherpaOnnxModelDeletion> {
  const modelDir = getSherpaOnnxModelDir(modelsDir, modelId);
  const stagedDir = `${modelDir}.deleting`;
  await rm(stagedDir, { recursive: true, force: true });
  if (await pathIsPresent(modelDir)) await rename(modelDir, stagedDir);

  return {
    commit: () => rm(stagedDir, { recursive: true, force: true }),
    rollback: async () => {
      if (!(await pathIsPresent(modelDir)) && (await pathIsPresent(stagedDir))) {
        await rename(stagedDir, modelDir);
      }
    },
  };
}
