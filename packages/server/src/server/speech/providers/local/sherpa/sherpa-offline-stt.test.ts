import { describe, expect, it } from "vitest";
import pino from "pino";

import {
  SherpaOfflineSTT,
  normalizeFireRedTranscript,
  normalizeSherpaTranscript,
} from "./sherpa-offline-stt.js";
import type { SherpaOfflineSttConfig } from "./sherpa-offline-stt.js";
import type { TranscriptionResult } from "../../../speech-provider.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class TestSherpaOfflineStt extends SherpaOfflineSTT {
  public readonly calls: Array<{ audio: Buffer; format: string }> = [];
  public readonly pending: Array<ReturnType<typeof createDeferred<TranscriptionResult>>> = [];

  constructor() {
    super(
      { engine: { sampleRate: 16000 } } as unknown as SherpaOfflineSttConfig,
      pino({ level: "silent" }),
    );
  }

  override async transcribeAudio(
    audioBuffer: Buffer,
    format: string,
  ): Promise<TranscriptionResult> {
    this.calls.push({ audio: Buffer.from(audioBuffer), format });
    const deferred = createDeferred<TranscriptionResult>();
    this.pending.push(deferred);
    return deferred.promise;
  }
}

function createProviderForAudioTest(resultText: string) {
  const state = { accepted: [] as Float32Array[], decodeCalls: 0 };
  const engine = {
    sampleRate: 16_000,
    modelKind: "fire_red_asr" as const,
    createStream: () => ({ free: () => undefined }),
    acceptWaveform: (_stream: unknown, _sampleRate: number, samples: Float32Array) => {
      state.accepted.push(samples);
    },
    recognizer: {
      decode: () => {
        state.decodeCalls += 1;
      },
      getResult: () => ({ text: resultText }),
    },
  } as unknown as SherpaOfflineSttConfig["engine"];

  return {
    provider: new SherpaOfflineSTT({ engine }, pino({ level: "silent" })),
    state,
  };
}

describe("SherpaOfflineSTT session", () => {
  it("snapshots segment ids and buffers before async transcription starts", async () => {
    const provider = new TestSherpaOfflineStt();
    const session = provider.createSession({
      logger: pino({ level: "silent" }),
      language: "en",
    });

    const committed: Array<{ segmentId: string; previousSegmentId: string | null }> = [];
    const transcripts: Array<{ segmentId: string; transcript: string; isFinal: boolean }> = [];

    session.on("committed", (payload) => {
      committed.push(payload);
    });
    session.on("transcript", (payload) => {
      transcripts.push(payload);
    });

    await session.connect();

    session.appendPcm16(Buffer.from([1, 2, 3, 4]));
    session.commit();
    session.appendPcm16(Buffer.from([5, 6, 7, 8]));
    session.commit();

    expect(committed).toHaveLength(2);
    expect(committed[1]?.segmentId).not.toBe(committed[0]?.segmentId);
    expect(committed[0]?.previousSegmentId).toBeNull();
    expect(committed[1]?.previousSegmentId).toBe(committed[0]?.segmentId);

    expect(provider.calls).toEqual([
      { audio: Buffer.from([1, 2, 3, 4]), format: "audio/pcm;rate=16000" },
      { audio: Buffer.from([5, 6, 7, 8]), format: "audio/pcm;rate=16000" },
    ]);

    provider.pending[0]?.resolve({ text: "first", duration: 1 });
    provider.pending[1]?.resolve({ text: "second", duration: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcripts).toHaveLength(2);
    expect(transcripts).toEqual([
      expect.objectContaining({
        segmentId: committed[0].segmentId,
        transcript: "first",
        isFinal: true,
      }),
      expect.objectContaining({
        segmentId: committed[1].segmentId,
        transcript: "second",
        isFinal: true,
      }),
    ]);
  });
});

describe("SherpaOfflineSTT silence handling", () => {
  it("transcribes quiet nonzero PCM instead of discarding it as silence", async () => {
    const { provider, state } = createProviderForAudioTest("QUIET SPEECH");
    const pcm16 = Buffer.alloc(4);
    pcm16.writeInt16LE(299, 0);
    pcm16.writeInt16LE(-299, 2);

    await expect(provider.transcribeAudio(pcm16, "audio/pcm;rate=16000")).resolves.toEqual(
      expect.objectContaining({ text: "quiet speech" }),
    );
    expect(state.decodeCalls).toBe(1);
    expect(state.accepted).toHaveLength(1);
    expect(Math.max(...state.accepted[0]!.map(Math.abs))).toBeGreaterThan(0);
  });

  it("skips recognition for all-zero PCM", async () => {
    const { provider, state } = createProviderForAudioTest("SHOULD NOT RUN");

    await expect(
      provider.transcribeAudio(Buffer.alloc(320), "audio/pcm;rate=16000"),
    ).resolves.toEqual(expect.objectContaining({ text: "", isLowConfidence: true }));
    expect(state.decodeCalls).toBe(0);
    expect(state.accepted).toHaveLength(0);
  });
});

describe("normalizeFireRedTranscript", () => {
  it("removes FireRed control tokens without leaking silence markers", () => {
    expect(normalizeFireRedTranscript("哈喽 <sil> 我觉得吧 <zh> <sil>")).toBe("哈喽 我觉得吧");
    expect(normalizeFireRedTranscript("<sil><eos>")).toBe("");
  });

  it("matches the official FireRed AED lowercase post-processing", () => {
    expect(normalizeFireRedTranscript("THIS IS A VOICE NOTE")).toBe("this is a voice note");
    expect(normalizeFireRedTranscript("我觉得吧 I THINK THIS IS GOOD")).toBe(
      "我觉得吧 i think this is good",
    );
    expect(normalizeFireRedTranscript("OpenAI API works")).toBe("openai api works");
  });
});

describe("normalizeSherpaTranscript", () => {
  it("preserves SenseVoice punctuation and casing", () => {
    expect(
      normalizeSherpaTranscript(
        "sense_voice",
        "你好，BySpace。 Please run npm test, then check TypeScript.",
      ),
    ).toBe("你好，BySpace。 Please run npm test, then check TypeScript.");
  });
});
