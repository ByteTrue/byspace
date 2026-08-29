import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveBySpaceHome } from "../src/server/byspace-home.js";
import { createRootLogger } from "../src/server/logger.js";
import {
  isSherpaOnnxModelReady,
  listLocalSpeechModels,
  LocalSttModelIdSchema,
  type LocalSttModelId,
} from "../src/server/speech/providers/local/models.js";
import { SherpaOfflineRecognizerEngine } from "../src/server/speech/providers/local/sherpa/sherpa-offline-recognizer.js";
import { SherpaOfflineSTT } from "../src/server/speech/providers/local/sherpa/sherpa-offline-stt.js";
import { resolveSherpaOfflineRecognizerConfig } from "../src/server/speech/providers/local/sherpa/model-catalog.js";

interface CliOptions {
  wavPath: string;
  outPath?: string;
  model: LocalSttModelId;
  modelsDir: string;
}

function usage(): string {
  return "Usage: npm run speech:transcribe:local -- <wavPath> [--out <path>] [--model <id>] [--models-dir <dir>]";
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (argv.length === 0) throw new Error(`Missing <wavPath>\n\n${usage()}`);

  const defaultModel = listLocalSpeechModels()[0]?.id;
  if (!defaultModel) throw new Error("No local speech models are registered");
  let model = defaultModel;
  let modelsDir =
    process.env.BYSPACE_LOCAL_MODELS_DIR ??
    path.join(resolveBySpaceHome(), "models", "local-speech");
  let outPath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") outPath = path.resolve(argv[++i] ?? "");
    else if (arg === "--model") model = LocalSttModelIdSchema.parse(argv[++i]);
    else if (arg === "--models-dir") modelsDir = path.resolve(argv[++i] ?? "");
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (!positional[0]) throw new Error(`Missing <wavPath>\n\n${usage()}`);
  return {
    wavPath: path.resolve(positional[0]),
    ...(outPath ? { outPath } : {}),
    model,
    modelsDir,
  };
}

function readPcm16MonoWav(wav: Buffer): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a PCM WAV file");
  }
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | null =
    null;
  let pcm: Buffer | null = null;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && size >= 16) {
      format = {
        encoding: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        bits: wav.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      pcm = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16) {
    throw new Error("Expected mono 16-bit PCM WAV audio");
  }
  if (format.sampleRate !== 16_000) throw new Error("Expected 16 kHz WAV audio");
  if (!pcm) throw new Error("WAV file has no data chunk");
  return pcm;
}

const options = parseArgs(process.argv.slice(2));
const logger = createRootLogger({ level: "info", format: "pretty" });
if (!(await isSherpaOnnxModelReady(options.modelsDir, options.model))) {
  throw new Error(`Model ${options.model} is not installed. Run npm run speech:download first.`);
}

const engine = new SherpaOfflineRecognizerEngine(
  resolveSherpaOfflineRecognizerConfig(options.modelsDir, options.model),
  logger,
);
try {
  const provider = new SherpaOfflineSTT({ engine }, logger);
  const session = provider.createSession({ logger, language: "auto" });
  const transcript = new Promise<string>((resolve, reject) => {
    session.on("transcript", (event) => {
      if (event.isFinal) resolve(event.transcript.trim());
    });
    session.on("error", reject);
  });
  await session.connect();
  session.appendPcm16(readPcm16MonoWav(await readFile(options.wavPath)));
  session.commit();
  const result = await transcript;
  session.close();
  if (options.outPath) {
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, `${result}\n`, "utf8");
  }
  process.stdout.write(`${result}\n`);
} finally {
  engine.free();
}
