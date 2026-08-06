import { EventEmitter } from "node:events";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";

import { DictationStreamManager } from "./dictation-stream-manager.js";

class FakeRealtimeSession extends EventEmitter implements StreamingTranscriptionSession {
  connected = false;
  appended: Buffer[] = [];
  commitCalls = 0;
  clearCalls = 0;
  closed = false;
  requiredSampleRate = 24_000;
  private lastCommittedSegmentId: string | null = null;

  async connect(): Promise<void> {
    this.connected = true;
  }

  appendPcm16(pcm16le: Buffer): void {
    this.appended.push(pcm16le);
  }

  commit(): void {
    this.commitCalls += 1;
  }

  clear(): void {
    this.clearCalls += 1;
  }

  close(): void {
    this.closed = true;
  }

  emitCommitted(
    segmentId: string,
    previousSegmentId: string | null = this.lastCommittedSegmentId,
  ): void {
    this.emit("committed", { segmentId, previousSegmentId });
    this.lastCommittedSegmentId = segmentId;
  }

  emitTranscript(segmentId: string, transcript: string, isFinal = true): void {
    this.emit("transcript", { segmentId, transcript, isFinal });
  }

  emitError(message: string): void {
    this.emit("error", new Error(message));
  }
}

class FakeSttProvider implements SpeechToTextProvider {
  readonly id = "fake";
  lastLanguage?: string;

  constructor(private readonly session: FakeRealtimeSession) {}

  createSession(
    params: Parameters<SpeechToTextProvider["createSession"]>[0],
  ): StreamingTranscriptionSession {
    this.lastLanguage = params.language;
    return this.session;
  }
}

interface EmittedMessage {
  type: string;
  payload: unknown;
}

function buildPcmBase64(sampleValue: number, sampleCount: number): string {
  const samples = new Int16Array(sampleCount);
  samples.fill(sampleValue);
  return Buffer.from(samples.buffer).toString("base64");
}

function buildPcmSequenceBase64(
  segments: Array<{ sampleValue: number; sampleCount: number }>,
): string {
  return Buffer.concat(
    segments.map(({ sampleValue, sampleCount }) => {
      const samples = new Int16Array(sampleCount);
      samples.fill(sampleValue);
      return Buffer.from(samples.buffer);
    }),
  ).toString("base64");
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createManager(input: {
  session: FakeRealtimeSession;
  emitted: EmittedMessage[];
  backgroundCommitSeconds?: number;
  finalTimeoutMs?: number;
  debug?: ConstructorParameters<typeof DictationStreamManager>[0]["debug"];
}): DictationStreamManager {
  return new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => input.emitted.push(message),
    sessionId: "s1",
    stt: new FakeSttProvider(input.session),
    backgroundCommitSeconds: input.backgroundCommitSeconds,
    finalTimeoutMs: input.finalTimeoutMs,
    debug: input.debug,
  });
}

function finalText(emitted: EmittedMessage[]): string | undefined {
  const final = emitted.find((message) => message.type === "dictation_stream_final");
  return (final?.payload as { text?: string } | undefined)?.text;
}

describe("DictationStreamManager", () => {
  const originalDebug = process.env.BYSPACE_DICTATION_DEBUG;

  beforeEach(() => {
    process.env.BYSPACE_DICTATION_DEBUG = "false";
  });

  afterEach(() => {
    process.env.BYSPACE_DICTATION_DEBUG = originalDebug;
    vi.useRealTimers();
  });

  it("does not require OPENAI_API_KEY", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const session = new FakeRealtimeSession();
      const emitted: EmittedMessage[] = [];
      const manager = createManager({ session, emitted });

      await manager.handleStart("d-local", "audio/pcm;rate=16000;bits=16");

      expect(session.connected).toBe(true);
      expect(emitted.find((message) => message.type === "dictation_stream_error")).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it("keeps natural pauses inside one recording and emits only the final transcript", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 10 });

    await manager.handleStart("d-pauses", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-pauses",
      seq: 0,
      audioBase64: buildPcmSequenceBase64([
        { sampleValue: 2000, sampleCount: 14_400 },
        { sampleValue: 0, sampleCount: 48_000 },
        { sampleValue: 2000, sampleCount: 12_000 },
      ]),
      format: "audio/pcm;rate=24000;bits=16",
    });

    expect(session.commitCalls).toBe(0);
    expect(emitted.some((message) => message.type === "dictation_stream_partial")).toBe(false);

    await manager.handleFinish("d-pauses", 0);
    expect(session.commitCalls).toBe(1);
    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "first second");
    await tick();

    expect(finalText(emitted)).toBe("first second");
  });

  it("does not discard quiet nonzero speech behind an amplitude threshold", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 1 });

    await manager.handleStart("d-quiet", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-quiet",
      seq: 0,
      audioBase64: buildPcmBase64(1, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });

    expect(session.commitCalls).toBe(1);
  });

  it("precomputes fixed-duration segments without exposing partial text", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 1 });

    await manager.handleStart("d-segmented", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-segmented",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    expect(session.commitCalls).toBe(1);
    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello");

    await manager.handleChunk({
      dictationId: "d-segmented",
      seq: 1,
      audioBase64: buildPcmBase64(2000, 12_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-segmented", 1);
    expect(session.commitCalls).toBe(2);
    expect(emitted.some((message) => message.type === "dictation_stream_partial")).toBe(false);

    session.emitCommitted("seg-2");
    session.emitTranscript("seg-2", "world");
    await tick();

    expect(finalText(emitted)).toBe("hello world");
  });

  it("waits for a background segment when stop lands on its boundary", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({
      session,
      emitted,
      backgroundCommitSeconds: 1,
      finalTimeoutMs: 5_000,
    });

    await manager.handleStart("d-boundary", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-boundary",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-boundary", 0);

    expect(finalText(emitted)).toBeUndefined();
    const accepted = emitted.find((message) => message.type === "dictation_stream_finish_accepted");
    expect((accepted?.payload as { timeoutMs?: number } | undefined)?.timeoutMs).toBeGreaterThan(
      5_000,
    );

    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello");
    await tick();
    expect(finalText(emitted)).toBe("hello");
  });

  it("waits for both a background segment and the final tail", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 1 });

    await manager.handleStart("d-tail", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-tail",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleChunk({
      dictationId: "d-tail",
      seq: 1,
      audioBase64: buildPcmBase64(2000, 12_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-tail", 1);

    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello");
    expect(finalText(emitted)).toBeUndefined();

    session.emitCommitted("seg-2");
    expect(finalText(emitted)).toBeUndefined();
    session.emitTranscript("seg-2", "world");
    await tick();

    expect(finalText(emitted)).toBe("hello world");
  });

  it("orders asynchronously completed background segments by their chain", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 1 });

    await manager.handleStart("d-reordered", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-reordered",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 48_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-reordered", 0);

    session.emitCommitted("seg-2", "seg-1");
    session.emitTranscript("seg-2", "second task");
    expect(finalText(emitted)).toBeUndefined();

    session.emitCommitted("seg-1", null);
    session.emitTranscript("seg-1", "first task");
    await tick();

    expect(finalText(emitted)).toBe("first task second task");
  });

  it("keeps adjacent Mandarin segments readable without inventing sentence breaks", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 1 });

    await manager.handleStart("d-mandarin", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-mandarin",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 48_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-mandarin", 0);

    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "“你好”");
    session.emitCommitted("seg-2");
    session.emitTranscript("seg-2", "世界");
    await tick();

    expect(finalText(emitted)).toBe("“你好”世界");
  });

  it("clears a silence-only recording without invoking recognition", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, backgroundCommitSeconds: 10 });

    await manager.handleStart("d-silence", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-silence",
      seq: 0,
      audioBase64: buildPcmBase64(0, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-silence", 0);
    await tick();

    expect(session.commitCalls).toBe(0);
    expect(session.clearCalls).toBe(1);
    expect(finalText(emitted)).toBe("");
  });

  it("does not emit a final after cancel while debug persistence is pending", async () => {
    vi.useFakeTimers();
    const persistence = createDeferred<string | null>();
    let persistCalls = 0;
    const debug = {
      isEnabled: () => true,
      createChunkWriter: () => null,
      persistAudio: () => {
        persistCalls += 1;
        return persistence.promise;
      },
    };
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({
      session,
      emitted,
      backgroundCommitSeconds: 10,
      finalTimeoutMs: 1,
      debug,
    });

    await manager.handleStart("d-cancel-persist", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-cancel-persist",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-cancel-persist", 0);
    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello");
    session.emitTranscript("seg-1", "hello");
    await tick();

    expect(persistCalls).toBe(1);
    expect(finalText(emitted)).toBeUndefined();
    await manager.handleFinish("d-cancel-persist", 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(persistCalls).toBe(1);
    expect(emitted.some((message) => message.type === "dictation_stream_error")).toBe(false);
    expect(session.closed).toBe(false);
    manager.handleCancel("d-cancel-persist");
    persistence.resolve("/tmp/dictation.wav");
    await tick();

    expect(finalText(emitted)).toBeUndefined();
    expect(emitted.some((message) => message.type === "activity_log")).toBe(false);
    expect(session.closed).toBe(true);
  });

  it("treats buffer-too-small as benign and finalizes an existing result", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({ session, emitted, finalTimeoutMs: 5_000 });

    await manager.handleStart("d-small", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-small",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 2_400),
      format: "audio/pcm;rate=24000;bits=16",
    });
    session.emitTranscript("seg-1", "hello world");
    await manager.handleFinish("d-small", 0);
    session.emitError("Error committing input audio buffer: buffer too small");
    await tick();

    expect(emitted.find((message) => message.type === "dictation_stream_error")).toBeUndefined();
    expect(finalText(emitted)).toBe("hello world");
    expect(session.closed).toBe(true);
  });

  it("budgets finish timeout for pending background recognition", async () => {
    const session = new FakeRealtimeSession();
    const emitted: EmittedMessage[] = [];
    const manager = createManager({
      session,
      emitted,
      backgroundCommitSeconds: 1,
      finalTimeoutMs: 5_000,
    });

    await manager.handleStart("d-timeout", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-timeout",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24_000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-timeout", 0);

    const accepted = emitted.find((message) => message.type === "dictation_stream_finish_accepted");
    expect((accepted?.payload as { timeoutMs?: number } | undefined)?.timeoutMs).toBeGreaterThan(
      5_000,
    );
  });
});
