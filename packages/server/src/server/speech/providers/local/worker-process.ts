import pino from "pino";
import type { StreamingTranscriptionSession } from "../../speech-provider.js";
import type { LocalSttModelId } from "./models.js";
import { resolveSherpaOfflineRecognizerConfig } from "./sherpa/model-catalog.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa/sherpa-offline-recognizer.js";
import { SherpaOfflineSTT } from "./sherpa/sherpa-offline-stt.js";
import type {
  LocalSpeechWorkerConfig,
  LocalSpeechWorkerRequest,
  LocalSpeechWorkerToParentMessage,
} from "./worker-protocol.js";
import { workerBytesToBuffer } from "./worker-bytes.js";

process.title = "BySpace Dictation";

const logger = pino({ level: process.env.BYSPACE_LOG_LEVEL ?? "info" }).child({
  module: "speech",
  component: "local-worker",
});
const engines = new Map<string, SherpaOfflineRecognizerEngine>();
const providers = new Map<string, SherpaOfflineSTT>();
const sessions = new Map<string, StreamingTranscriptionSession>();
let ipcClosing = false;

function sendToParent(message: LocalSpeechWorkerToParentMessage): void {
  if (ipcClosing || !process.connected || !process.send) return;
  try {
    process.send(message, (error) => {
      if (error) ipcClosing = true;
    });
  } catch {
    ipcClosing = true;
  }
}

function providerFor(config: LocalSpeechWorkerConfig): SherpaOfflineSTT {
  const key = `${config.modelsDir}:${config.dictationSttModel}`;
  const existing = providers.get(key);
  if (existing) return existing;
  const engine = new SherpaOfflineRecognizerEngine(
    resolveSherpaOfflineRecognizerConfig(
      config.modelsDir,
      config.dictationSttModel as LocalSttModelId,
    ),
    logger,
  );
  const provider = new SherpaOfflineSTT({ engine }, logger);
  engines.set(key, engine);
  providers.set(key, provider);
  return provider;
}

function cleanupSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  try {
    session?.close();
  } catch {
    // best effort
  }
}

async function createSession(
  message: Extract<LocalSpeechWorkerRequest, { type: "session.create" }>,
): Promise<{ requiredSampleRate: number }> {
  cleanupSession(message.sessionId);
  const session = providerFor(message.config).createSession({ logger, language: "auto" });
  session.on("committed", (payload) =>
    sendToParent({ type: "session.committed", sessionId: message.sessionId, payload }),
  );
  session.on("transcript", (payload) =>
    sendToParent({ type: "session.transcript", sessionId: message.sessionId, payload }),
  );
  session.on("error", (error) =>
    sendToParent({
      type: "session.error",
      sessionId: message.sessionId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  await session.connect();
  sessions.set(message.sessionId, session);
  return { requiredSampleRate: session.requiredSampleRate };
}

function sendOk(requestId: string, result?: unknown): void {
  sendToParent({ type: "response", requestId, ok: true, result });
}

async function handleRequest(message: LocalSpeechWorkerRequest): Promise<void> {
  if (message.type === "session.create") {
    sendOk(message.requestId, await createSession(message));
    return;
  }
  if (message.type === "session.close") {
    cleanupSession(message.sessionId);
    sendOk(message.requestId);
    return;
  }

  const session = sessions.get(message.sessionId);
  switch (message.type) {
    case "session.append":
      session?.appendPcm16(workerBytesToBuffer(message.audio));
      break;
    case "session.commit":
      session?.commit();
      break;
    case "session.clear":
      session?.clear();
      break;
    case "session.flush":
      if (session && "flush" in session && typeof session.flush === "function") session.flush();
      break;
    case "session.reset":
      if (session && "reset" in session && typeof session.reset === "function") session.reset();
      break;
  }
  sendOk(message.requestId);
}

process.on("message", (message: LocalSpeechWorkerRequest) => {
  void handleRequest(message).catch((error: unknown) => {
    sendToParent({
      type: "response",
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Local speech worker request failed",
    });
  });
});

process.once("disconnect", () => {
  ipcClosing = true;
  for (const sessionId of sessions.keys()) cleanupSession(sessionId);
  for (const engine of engines.values()) engine.free();
});
