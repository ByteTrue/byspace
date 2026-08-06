import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import type pino from "pino";
import type { SpeechToTextProvider, StreamingTranscriptionSession } from "../../speech-provider.js";
import { applySherpaLoaderEnv } from "./sherpa/sherpa-runtime-env.js";
import type {
  LocalSpeechCreateSessionResult,
  LocalSpeechSessionKind,
  LocalSpeechWorkerConfig,
  LocalSpeechWorkerRequest,
  LocalSpeechWorkerToParentMessage,
} from "./worker-protocol.js";
import { bufferToWorkerBytes } from "./worker-bytes.js";

const REQUEST_TIMEOUT_MS = 60_000;

type RequestInput = LocalSpeechWorkerRequest extends infer Request
  ? Request extends LocalSpeechWorkerRequest
    ? Omit<Request, "requestId">
    : never
  : never;

interface WorkerProcess {
  connected: boolean;
  send(message: LocalSpeechWorkerRequest, callback: (error: Error | null) => void): boolean;
  disconnect(): void;
  kill(): boolean;
  on(event: "message", listener: (message: LocalSpeechWorkerToParentMessage) => void): this;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

function workerUrl(): URL {
  return new URL(
    import.meta.url.endsWith(".ts") ? "./worker-process.ts" : "./worker-process.js",
    import.meta.url,
  );
}

function workerExecArgv(): string[] {
  if (!import.meta.url.endsWith(".ts")) return [];
  const loaderUrl = new URL("../../../../terminal/terminal-ts-loader.mjs", import.meta.url).href;
  const source = `import { register } from "node:module"; import { pathToFileURL } from "node:url"; register(${JSON.stringify(loaderUrl)}, pathToFileURL("./"));`;
  return [
    "--experimental-strip-types",
    "--import",
    `data:text/javascript,${encodeURIComponent(source)}`,
  ];
}

function createWorker(): WorkerProcess {
  const env = { ...process.env };
  applySherpaLoaderEnv(env);
  return fork(fileURLToPath(workerUrl()), [], {
    env,
    execArgv: workerExecArgv(),
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  }) as WorkerProcess;
}

export class LocalSpeechWorkerClient {
  private worker: WorkerProcess | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly activeSessions = new Set<string>();
  private modelMutationInProgress = false;

  constructor(
    private readonly options: {
      config: LocalSpeechWorkerConfig;
      logger: pino.Logger;
      forkWorker?: () => WorkerProcess;
    },
  ) {}

  hasActiveSessions(): boolean {
    return this.activeSessions.size > 0;
  }

  beginModelMutation(): () => void {
    if (this.modelMutationInProgress || this.hasActiveSessions()) {
      throw new Error("Stop the current dictation before changing models");
    }
    this.modelMutationInProgress = true;
    return () => {
      this.modelMutationInProgress = false;
    };
  }

  async createSession(
    kind: LocalSpeechSessionKind,
    emitter: EventEmitter,
  ): Promise<{ sessionId: string; requiredSampleRate: number }> {
    const sessionId = randomUUID();
    if (this.modelMutationInProgress) throw new Error("The dictation model is changing");
    this.emitters.set(sessionId, emitter);
    this.activeSessions.add(sessionId);
    try {
      const result = await this.request<LocalSpeechCreateSessionResult>({
        type: "session.create",
        config: this.options.config,
        sessionId,
        kind,
      });
      return { sessionId, requiredSampleRate: result.requiredSampleRate };
    } catch (error) {
      this.activeSessions.delete(sessionId);
      this.emitters.delete(sessionId);
      throw error;
    }
  }

  appendSessionAudio(sessionId: string, audio: Buffer): void {
    void this.request({
      type: "session.append",
      sessionId,
      audio: bufferToWorkerBytes(audio),
    }).catch((error) => this.emitters.get(sessionId)?.emit("error", error));
  }

  commitSession(sessionId: string): void {
    void this.request({ type: "session.commit", sessionId }).catch((error) =>
      this.emitters.get(sessionId)?.emit("error", error),
    );
  }

  clearSession(sessionId: string): void {
    void this.request({ type: "session.clear", sessionId }).catch((error) =>
      this.emitters.get(sessionId)?.emit("error", error),
    );
  }

  flushSession(sessionId: string): void {
    void this.request({ type: "session.flush", sessionId }).catch((error) =>
      this.emitters.get(sessionId)?.emit("error", error),
    );
  }

  resetSession(sessionId: string): void {
    void this.request({ type: "session.reset", sessionId }).catch((error) =>
      this.emitters.get(sessionId)?.emit("error", error),
    );
  }

  closeSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.emitters.delete(sessionId);
    void this.request({ type: "session.close", sessionId }).catch(() => undefined);
  }

  shutdown(): void {
    const worker = this.worker;
    this.worker = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Dictation worker stopped"));
    }
    this.pending.clear();
    for (const emitter of this.emitters.values())
      emitter.emit("error", new Error("Dictation worker stopped"));
    this.emitters.clear();
    this.activeSessions.clear();
    this.modelMutationInProgress = false;
    worker?.disconnect();
    worker?.kill();
  }

  private ensureWorker(): WorkerProcess {
    if (this.worker?.connected) return this.worker;
    const worker = this.options.forkWorker?.() ?? createWorker();
    this.worker = worker;
    worker.on("message", (message: LocalSpeechWorkerToParentMessage) =>
      this.handleMessage(message),
    );
    worker.once("close", (code, signal) => {
      if (this.worker === worker) this.worker = null;
      const error = new Error(`Dictation worker exited (${code ?? signal ?? "unknown"})`);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
      for (const emitter of this.emitters.values()) emitter.emit("error", error);
      this.activeSessions.clear();
    });
    return worker;
  }

  private handleMessage(message: LocalSpeechWorkerToParentMessage): void {
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
      return;
    }
    const emitter = this.emitters.get(message.sessionId);
    if (!emitter) return;
    if (message.type === "session.committed") emitter.emit("committed", message.payload);
    else if (message.type === "session.transcript") emitter.emit("transcript", message.payload);
    else emitter.emit("error", new Error(message.error));
  }

  private request<T = void>(input: RequestInput): Promise<T> {
    const requestId = randomUUID();
    const message = { ...input, requestId } as LocalSpeechWorkerRequest;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Dictation worker request timed out: ${message.type}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      const worker = this.ensureWorker();
      worker.send(message, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(pending.timeout);
        pending.reject(error);
      });
    });
  }
}

class WorkerBackedTranscriptionSession
  extends EventEmitter
  implements StreamingTranscriptionSession
{
  requiredSampleRate = 16_000;
  private sessionId: string | null = null;

  constructor(private readonly client: LocalSpeechWorkerClient) {
    super();
  }

  async connect(): Promise<void> {
    if (this.sessionId) return;
    const created = await this.client.createSession("dictationStt", this);
    this.sessionId = created.sessionId;
    this.requiredSampleRate = created.requiredSampleRate;
  }

  appendPcm16(chunk: Buffer): void {
    if (this.sessionId) this.client.appendSessionAudio(this.sessionId, chunk);
  }

  commit(): void {
    if (this.sessionId) this.client.commitSession(this.sessionId);
  }

  clear(): void {
    if (this.sessionId) this.client.clearSession(this.sessionId);
  }

  flush(): void {
    if (this.sessionId) this.client.flushSession(this.sessionId);
  }

  reset(): void {
    if (this.sessionId) this.client.resetSession(this.sessionId);
  }

  close(): void {
    if (!this.sessionId) return;
    this.client.closeSession(this.sessionId);
    this.sessionId = null;
    this.removeAllListeners();
  }
}

export class WorkerBackedSpeechToTextProvider implements SpeechToTextProvider {
  readonly id = "local" as const;
  readonly dictationBackgroundCommitSeconds: number | undefined;

  constructor(
    private readonly client: LocalSpeechWorkerClient,
    options?: { dictationBackgroundCommitSeconds?: number },
  ) {
    this.dictationBackgroundCommitSeconds = options?.dictationBackgroundCommitSeconds;
  }

  createSession(): StreamingTranscriptionSession {
    return new WorkerBackedTranscriptionSession(this.client);
  }
}
