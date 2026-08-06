import { EventEmitter } from "node:events";
import { once } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { LocalSpeechWorkerClient, WorkerBackedSpeechToTextProvider } from "./worker-client.js";
import type {
  LocalSpeechWorkerRequest,
  LocalSpeechWorkerToParentMessage,
} from "./worker-protocol.js";
import { workerBytesToBuffer } from "./worker-bytes.js";

class FakeLocalSpeechWorker extends EventEmitter {
  public connected = true;
  public killed = false;
  public pid = 12345;
  public readonly stderr = new EventEmitter() as NodeJS.ReadableStream;
  public readonly sent: LocalSpeechWorkerRequest[] = [];
  public disconnects = 0;
  public kills = 0;

  send(message: LocalSpeechWorkerRequest, callback: (error: Error | null) => void): boolean {
    this.sent.push(message);
    queueMicrotask(() => callback(null));
    return true;
  }

  disconnect(): void {
    this.disconnects++;
    this.connected = false;
  }

  kill(): boolean {
    this.kills++;
    this.killed = true;
    this.connected = false;
    return true;
  }

  respond(request: LocalSpeechWorkerRequest, result?: unknown): void {
    this.emit("message", {
      type: "response",
      requestId: request.requestId,
      ok: true,
      result,
    } satisfies LocalSpeechWorkerToParentMessage);
  }

  emitWorkerMessage(message: LocalSpeechWorkerToParentMessage): void {
    this.emit("message", message);
  }
}

class PausedIpcWorker {
  private readonly child: ChildProcess;

  constructor() {
    this.child = fork(
      fileURLToPath(new URL("./test-fixtures/paused-ipc-worker.cjs", import.meta.url)),
      [],
      { serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
  }

  get connected(): boolean {
    return this.child.connected;
  }

  get killed(): boolean {
    return this.child.killed;
  }

  send(message: LocalSpeechWorkerRequest, callback: (error: Error | null) => void): boolean {
    return this.child.send(message, (error) => callback(error ?? null));
  }

  disconnect(): void {
    this.child.disconnect();
  }

  kill(): boolean {
    return this.child.kill();
  }

  on(event: "message", listener: (message: LocalSpeechWorkerToParentMessage) => void): this;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(
    event: "message" | "close",
    listener:
      | ((message: LocalSpeechWorkerToParentMessage) => void)
      | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ): this {
    this.child.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this {
    this.child.once(event, listener);
    return this;
  }
}

function createClient() {
  const workers: FakeLocalSpeechWorker[] = [];
  const client = new LocalSpeechWorkerClient({
    logger: pino({ level: "silent" }),
    config: {
      modelsDir: "/tmp/models",
      dictationSttModel: "fire-red-asr2-aed-int8",
    },
    forkWorker: () => {
      const worker = new FakeLocalSpeechWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { client, workers };
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("LocalSpeechWorkerClient", () => {
  it("does not spawn the worker until first local speech use", () => {
    const { workers } = createClient();

    expect(workers).toHaveLength(0);
  });

  it("forwards STT session audio and transcript events through IPC", async () => {
    const { client, workers } = createClient();
    const provider = new WorkerBackedSpeechToTextProvider(client);
    const session = provider.createSession({ logger: pino({ level: "silent" }) });

    const transcriptPromise = once(session as EventEmitter, "transcript");
    const committedPromise = once(session as EventEmitter, "committed");

    const connect = session.connect();
    expect(client.hasActiveSessions()).toBe(true);
    const createRequest = workers[0].sent[0];
    expect(createRequest).toMatchObject({ type: "session.create", kind: "dictationStt" });
    workers[0].respond(createRequest, { requiredSampleRate: 16000 });
    await connect;

    session.appendPcm16(Buffer.from([9, 8, 7, 6]));
    await waitForMicrotasks();
    const appendRequest = workers[0].sent[1];
    expect(appendRequest).toMatchObject({
      type: "session.append",
      sessionId: createRequest.sessionId,
    });
    if (appendRequest.type !== "session.append") {
      throw new Error("Expected session.append request");
    }
    expect(Buffer.from(appendRequest.audio)).toEqual(Buffer.from([9, 8, 7, 6]));
    expect(workerBytesToBuffer(appendRequest.audio).byteOffset).toBe(0);

    session.commit();
    await waitForMicrotasks();
    expect(workers[0].sent[2]).toMatchObject({
      type: "session.commit",
      sessionId: createRequest.sessionId,
    });

    workers[0].emitWorkerMessage({
      type: "session.committed",
      sessionId: createRequest.sessionId,
      payload: { segmentId: "seg-1", previousSegmentId: null },
    });
    workers[0].emitWorkerMessage({
      type: "session.transcript",
      sessionId: createRequest.sessionId,
      payload: { segmentId: "seg-1", transcript: "hello", isFinal: true },
    });

    await expect(committedPromise).resolves.toEqual([
      { segmentId: "seg-1", previousSegmentId: null },
    ]);
    await expect(transcriptPromise).resolves.toEqual([
      { segmentId: "seg-1", transcript: "hello", isFinal: true },
    ]);

    session.close();
    expect(client.hasActiveSessions()).toBe(false);
  });

  it("reserves a session before the worker confirms creation", async () => {
    const workers: PausedIpcWorker[] = [];
    const client = new LocalSpeechWorkerClient({
      logger: pino({ level: "silent" }),
      config: { modelsDir: "/tmp/models", dictationSttModel: "fire-red-asr2-aed-int8" },
      forkWorker: () => {
        const worker = new PausedIpcWorker();
        workers.push(worker);
        return worker;
      },
    });
    const session = new WorkerBackedSpeechToTextProvider(client).createSession({
      logger: pino({ level: "silent" }),
    });
    session.on("error", () => undefined);

    const connect = session.connect();
    await waitForMicrotasks();
    expect(() => client.beginModelMutation()).toThrow(
      "Stop the current dictation before changing models",
    );

    client.shutdown();
    await expect(connect).rejects.toThrow();
    for (const worker of workers) worker.kill();
  });

  it("does not surface real IPC backpressure when replaying native-sized dictation frames", async () => {
    const workers: PausedIpcWorker[] = [];
    const client = new LocalSpeechWorkerClient({
      logger: pino({ level: "silent" }),
      config: { modelsDir: "/tmp/models", dictationSttModel: "fire-red-asr2-aed-int8" },
      forkWorker: () => {
        const worker = new PausedIpcWorker();
        workers.push(worker);
        return worker;
      },
    });
    const provider = new WorkerBackedSpeechToTextProvider(client);
    const session = provider.createSession({ logger: pino({ level: "silent" }) });
    let observedError: Error | null = null;
    (session as EventEmitter).on("error", (error: Error) => {
      observedError = error;
    });

    try {
      await session.connect();
      const nativeFrame = Buffer.alloc(1024, 1);

      for (let seq = 0; seq < 480; seq += 1) {
        session.appendPcm16(nativeFrame);
      }
      session.commit();
      await waitForMicrotasks();

      expect(observedError?.message).not.toBe("Local speech worker IPC channel is not writable");
    } finally {
      client.shutdown();
      for (const worker of workers) {
        worker.kill();
      }
    }
  });

  it("rejects a pending session when the worker exits", async () => {
    const workers: FakeLocalSpeechWorker[] = [];
    const client = new LocalSpeechWorkerClient({
      logger: pino({ level: "silent" }),
      config: { modelsDir: "/tmp/models", dictationSttModel: "fire-red-asr2-aed-int8" },
      forkWorker: () => {
        const worker = new FakeLocalSpeechWorker();
        workers.push(worker);
        return worker;
      },
    });
    const session = new WorkerBackedSpeechToTextProvider(client).createSession({
      logger: pino({ level: "silent" }),
    });
    session.on("error", () => undefined);

    const connect = session.connect();
    workers[0].emit("close", null, "SIGABRT");

    await expect(connect).rejects.toThrow("Dictation worker exited (SIGABRT)");
  });
});
