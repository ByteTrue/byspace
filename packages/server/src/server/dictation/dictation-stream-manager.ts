import type pino from "pino";
import { v4 as uuidv4 } from "uuid";
import {
  createDictationDebugChunkWriter,
  maybePersistDictationDebugAudio,
  type DictationDebugChunkWriter,
} from "../agent/dictation-debug.js";
import { isBySpaceDictationDebugEnabled } from "../agent/recordings-debug.js";
import { Pcm16MonoResampler } from "../agent/pcm16-resampler.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";
import { toResolver, type Resolvable } from "../speech/provider-resolver.js";
import { parsePcmRateFromFormat, pcm16lePeakAbs } from "../speech/audio.js";

const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const DEFAULT_DICTATION_FINAL_TIMEOUT_MS = 10000;
const DEFAULT_DICTATION_BACKGROUND_COMMIT_SECONDS = 15;
const DICTATION_FINAL_TIMEOUT_MAX_MS = 5 * 60 * 1000;
const DICTATION_FINAL_TIMEOUT_PER_PENDING_SEGMENT_MS = 15 * 1000;
const DICTATION_FINAL_TIMEOUT_PER_PENDING_AUDIO_SECOND_MS = 1500;
const DICTATION_FINAL_TIMEOUT_PER_MISSING_SEQ_MS = 250;

interface DictationDebugPort {
  isEnabled: typeof isBySpaceDictationDebugEnabled;
  createChunkWriter: typeof createDictationDebugChunkWriter;
  persistAudio: typeof maybePersistDictationDebugAudio;
}

const DEFAULT_DICTATION_DEBUG_PORT: DictationDebugPort = {
  isEnabled: isBySpaceDictationDebugEnabled,
  createChunkWriter: createDictationDebugChunkWriter,
  persistAudio: maybePersistDictationDebugAudio,
};

const CJK_BOUNDARY_START_RE = /^[\p{Script=Han}，。！？、；：“‘「『【（]/u;
const CJK_BOUNDARY_END_RE = /[\p{Script=Han}，。！？、；：”’」』】）]$/u;
const CJK_NO_LEADING_SPACE_RE = /^[，。！？、；：”’」』】）]/u;

function joinTranscriptSegments(segments: string[]): string {
  let joined = "";

  for (const segment of segments) {
    const text = segment.trim();
    if (!text) {
      continue;
    }
    if (!joined) {
      joined = text;
    } else if (
      CJK_NO_LEADING_SPACE_RE.test(text) ||
      (CJK_BOUNDARY_END_RE.test(joined) && CJK_BOUNDARY_START_RE.test(text))
    ) {
      joined += text;
    } else {
      joined += ` ${text}`;
    }
  }

  return joined;
}

function convertPCMToWavBuffer(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const headerSize = 44;
  const wavBuffer = Buffer.alloc(headerSize + pcmBuffer.length);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

interface DictationStreamState {
  dictationId: string;
  sessionId: string;
  inputFormat: string;
  stt: StreamingTranscriptionSession;
  inputRate: number;
  outputRate: number;
  resampler: Pcm16MonoResampler | null;
  debugAudioChunks: Buffer[];
  debugRecordingPath: string | null;
  debugChunkWriter: DictationDebugChunkWriter | null;
  receivedChunks: Map<number, Buffer>;
  nextSeqToForward: number;
  ackSeq: number;
  backgroundCommitBytes: number;
  bytesSinceCommit: number;
  peakSinceCommit: number;
  pendingBackgroundCommitAcknowledgements: number;
  committedSegmentIds: string[];
  pendingCommittedSegmentIdsByPreviousId: Map<string | null, string>;
  transcriptsBySegmentId: Map<string, string>;
  finalTranscriptSegmentIds: Set<string>;
  awaitingFinalCommit: boolean;
  finishRequested: boolean;
  finishSealed: boolean;
  finalizing: boolean;
  finalSeq: number | null;
  finalTimeout: ReturnType<typeof setTimeout> | null;
}

export type DictationStreamOutboundMessage =
  | { type: "dictation_stream_ack"; payload: { dictationId: string; ackSeq: number } }
  | {
      type: "dictation_stream_finish_accepted";
      payload: { dictationId: string; timeoutMs: number };
    }
  | {
      type: "dictation_stream_final";
      payload: { dictationId: string; text: string; debugRecordingPath?: string };
    }
  | {
      type: "dictation_stream_error";
      payload: {
        dictationId: string;
        error: string;
        retryable: boolean;
        debugRecordingPath?: string;
      };
    }
  | {
      type: "activity_log";
      payload: {
        id: string;
        timestamp: Date;
        type: "system";
        content: string;
        metadata: Record<string, unknown>;
      };
    };

export class DictationStreamManager {
  private readonly logger: pino.Logger;
  private readonly emit: (msg: DictationStreamOutboundMessage) => void;
  private readonly sessionId: string;
  private readonly resolveStt: () => SpeechToTextProvider | null;
  private readonly language: string;
  private readonly finalTimeoutMs: number;
  private readonly backgroundCommitSeconds: number;
  private readonly debug: DictationDebugPort;
  private readonly streams = new Map<string, DictationStreamState>();

  constructor(params: {
    logger: pino.Logger;
    emit: (msg: DictationStreamOutboundMessage) => void;
    sessionId: string;
    stt: Resolvable<SpeechToTextProvider | null>;
    language?: string;
    finalTimeoutMs?: number;
    backgroundCommitSeconds?: number;
    debug?: DictationDebugPort;
  }) {
    this.logger = params.logger.child({ component: "dictation-stream-manager" });
    this.emit = params.emit;
    this.sessionId = params.sessionId;
    this.resolveStt = toResolver(params.stt);
    this.language = params.language ?? "en";
    this.finalTimeoutMs = params.finalTimeoutMs ?? DEFAULT_DICTATION_FINAL_TIMEOUT_MS;
    this.backgroundCommitSeconds =
      params.backgroundCommitSeconds ?? DEFAULT_DICTATION_BACKGROUND_COMMIT_SECONDS;
    this.debug = params.debug ?? DEFAULT_DICTATION_DEBUG_PORT;
  }

  public cleanupAll(): void {
    for (const dictationId of this.streams.keys()) {
      this.cleanupDictationStream(dictationId);
    }
  }

  public async handleStart(dictationId: string, format: string): Promise<void> {
    this.cleanupDictationStream(dictationId);

    const sttProvider = this.resolveStt();
    if (!sttProvider) {
      this.failDictationStream(dictationId, "Dictation STT not configured", false);
      return;
    }

    const transcriptionPrompt =
      process.env.BYSPACE_DICTATION_TRANSCRIPTION_PROMPT ??
      "Transcribe only what the speaker says. Do not add words. Preserve punctuation and casing. If the audio is silence or non-speech noise, return an empty transcript.";

    let stt: ReturnType<SpeechToTextProvider["createSession"]>;
    try {
      stt = sttProvider.createSession({
        logger: this.logger.child({ dictationId }),
        language: this.language,
        prompt: transcriptionPrompt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failDictationStream(dictationId, message, false);
      return;
    }

    stt.on("committed", ({ segmentId, previousSegmentId }) => {
      const state = this.streams.get(dictationId);
      if (!state) {
        return;
      }

      state.pendingCommittedSegmentIdsByPreviousId.set(previousSegmentId, segmentId);
      let expectedPreviousSegmentId = state.committedSegmentIds.at(-1) ?? null;
      while (true) {
        const nextSegmentId =
          state.pendingCommittedSegmentIdsByPreviousId.get(expectedPreviousSegmentId);
        if (!nextSegmentId) {
          break;
        }
        state.pendingCommittedSegmentIdsByPreviousId.delete(expectedPreviousSegmentId);
        state.committedSegmentIds.push(nextSegmentId);

        const isBackgroundCommitAcknowledgement = state.pendingBackgroundCommitAcknowledgements > 0;
        if (isBackgroundCommitAcknowledgement) {
          state.pendingBackgroundCommitAcknowledgements -= 1;
        } else {
          state.bytesSinceCommit = 0;
          state.peakSinceCommit = 0;
        }

        if (
          state.finishRequested &&
          state.awaitingFinalCommit &&
          !isBackgroundCommitAcknowledgement
        ) {
          state.awaitingFinalCommit = false;
        }
        expectedPreviousSegmentId = nextSegmentId;
      }

      this.maybeFinalizeDictationStream(dictationId);
    });

    stt.on("transcript", ({ segmentId, transcript, isFinal }) => {
      const state = this.streams.get(dictationId);
      if (!state) {
        return;
      }
      state.transcriptsBySegmentId.set(segmentId, transcript);
      if (isFinal) {
        state.finalTranscriptSegmentIds.add(segmentId);
      }

      this.maybeSealDictationStreamFinish(dictationId);
      this.maybeFinalizeDictationStream(dictationId);
    });

    stt.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      const state = this.streams.get(dictationId);
      if (state && state.finishRequested && isBufferTooSmallError(message)) {
        if (state.awaitingFinalCommit) {
          state.awaitingFinalCommit = false;
        }
        this.maybeFinalizeDictationStream(dictationId);
        return;
      }
      void this.failAndCleanupDictationStream(dictationId, message, true);
    });

    try {
      await stt.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failDictationStream(dictationId, message, true);
      try {
        stt.close();
      } catch {
        // no-op
      }
      return;
    }

    const inputRate = parsePcmRateFromFormat(format, 16000) ?? 16000;
    if (!Number.isFinite(inputRate) || inputRate <= 0) {
      this.failDictationStream(
        dictationId,
        `Invalid dictation input rate in format: ${format}`,
        false,
      );
      try {
        stt.close();
      } catch {
        // no-op
      }
      return;
    }

    const debugChunkWriter = this.debug.createChunkWriter(
      { sessionId: this.sessionId, dictationId },
      this.logger,
    );

    const outputRate = stt.requiredSampleRate;
    const bytesPerSecond = outputRate * (PCM_BITS_PER_SAMPLE / 8);
    const backgroundCommitSeconds =
      sttProvider.dictationBackgroundCommitSeconds ?? this.backgroundCommitSeconds;
    const backgroundCommitBytes =
      backgroundCommitSeconds > 0
        ? Math.max(1, Math.round(backgroundCommitSeconds * bytesPerSecond))
        : 0;

    this.streams.set(dictationId, {
      dictationId,
      sessionId: this.sessionId,
      inputFormat: format,
      stt,
      inputRate,
      outputRate,
      resampler:
        inputRate === outputRate
          ? null
          : new Pcm16MonoResampler({
              inputRate,
              outputRate,
            }),
      debugAudioChunks: [],
      debugRecordingPath: null,
      debugChunkWriter,
      receivedChunks: new Map(),
      nextSeqToForward: 0,
      ackSeq: -1,
      backgroundCommitBytes,
      bytesSinceCommit: 0,
      peakSinceCommit: 0,
      pendingBackgroundCommitAcknowledgements: 0,
      committedSegmentIds: [],
      pendingCommittedSegmentIdsByPreviousId: new Map(),
      transcriptsBySegmentId: new Map(),
      finalTranscriptSegmentIds: new Set(),
      awaitingFinalCommit: false,
      finishRequested: false,
      finishSealed: false,
      finalizing: false,
      finalSeq: null,
      finalTimeout: null,
    });

    this.emitDictationAck(dictationId, -1);
  }

  public async handleChunk(params: {
    dictationId: string;
    seq: number;
    audioBase64: string;
    format: string;
  }): Promise<void> {
    const state = this.streams.get(params.dictationId);
    if (!state) {
      this.failDictationStream(params.dictationId, "Dictation stream not started", true);
      return;
    }

    if (params.format !== state.inputFormat) {
      void this.failAndCleanupDictationStream(
        params.dictationId,
        `Mismatched dictation stream format: ${params.format}`,
        false,
      );
      return;
    }

    if (params.seq < state.nextSeqToForward) {
      this.emitDictationAck(params.dictationId, state.ackSeq);
      return;
    }

    if (!state.receivedChunks.has(params.seq)) {
      state.receivedChunks.set(params.seq, Buffer.from(params.audioBase64, "base64"));
    }

    while (state.receivedChunks.has(state.nextSeqToForward)) {
      const seq = state.nextSeqToForward;
      const pcm16 = state.receivedChunks.get(seq)!;
      state.receivedChunks.delete(seq);

      const resampled = state.resampler ? state.resampler.processChunk(pcm16) : pcm16;
      if (resampled.length > 0) {
        try {
          this.appendDictationAudio(state, resampled);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void this.failAndCleanupDictationStream(params.dictationId, message, true);
          return;
        }

        if (state.debugChunkWriter) {
          void state.debugChunkWriter.writeChunk(seq, resampled).catch((err) => {
            this.logger.warn(
              { dictationId: params.dictationId, seq, err },
              "Failed to write debug chunk",
            );
          });
        }
      }

      state.nextSeqToForward += 1;
      state.ackSeq = state.nextSeqToForward - 1;
    }

    this.emitDictationAck(params.dictationId, state.ackSeq);
    this.maybeSealDictationStreamFinish(params.dictationId);
    this.maybeFinalizeDictationStream(params.dictationId);
  }

  public async handleFinish(dictationId: string, finalSeq: number): Promise<void> {
    const state = this.streams.get(dictationId);
    if (!state) {
      this.failDictationStream(dictationId, "Dictation stream not started", true);
      return;
    }

    state.finishRequested = true;
    state.finalSeq = finalSeq;

    if (
      finalSeq >= 0 &&
      state.ackSeq < 0 &&
      state.nextSeqToForward === 0 &&
      state.receivedChunks.size === 0
    ) {
      this.logger.debug(
        {
          dictationId,
          finalSeq,
          ackSeq: state.ackSeq,
          nextSeqToForward: state.nextSeqToForward,
          receivedChunks: state.receivedChunks.size,
          bytesSinceCommit: state.bytesSinceCommit,
        },
        "Dictation finish: no chunks received (failing fast)",
      );
      this.failDictationStream(
        dictationId,
        `Dictation finished (finalSeq=${finalSeq}) but no audio chunks were received`,
        true,
      );
      this.cleanupDictationStream(dictationId);
      return;
    }

    this.maybeSealDictationStreamFinish(dictationId);

    const updatedState = this.streams.get(dictationId);
    if (!updatedState) {
      return;
    }

    const timeoutEstimate = this.estimateFinalizationTimeout(updatedState);
    if (!updatedState.finalizing) {
      if (updatedState.finalTimeout) {
        clearTimeout(updatedState.finalTimeout);
      }
      updatedState.finalTimeout = setTimeout(() => {
        void this.failAndCleanupDictationStream(
          dictationId,
          "Timed out waiting for final transcription",
          true,
        );
      }, timeoutEstimate.timeoutMs);
    }

    this.emit({
      type: "dictation_stream_finish_accepted",
      payload: {
        dictationId,
        timeoutMs: timeoutEstimate.timeoutMs,
      },
    });

    this.logger.debug(
      {
        dictationId,
        finalSeq,
        ackSeq: updatedState.ackSeq,
        pendingSegments: timeoutEstimate.pendingSegments,
        pendingAudioSeconds: timeoutEstimate.pendingAudioSeconds,
        missingSeqCount: timeoutEstimate.missingSeqCount,
        timeoutMs: timeoutEstimate.timeoutMs,
      },
      "Accepted dictation finish request with adaptive timeout budget",
    );

    this.maybeFinalizeDictationStream(dictationId);
  }

  public handleCancel(dictationId: string): void {
    this.cleanupDictationStream(dictationId);
  }

  private emitDictationAck(dictationId: string, ackSeq: number): void {
    this.emit({ type: "dictation_stream_ack", payload: { dictationId, ackSeq } });
  }

  private async maybePersistDictationStreamAudio(dictationId: string): Promise<string | null> {
    if (!this.debug.isEnabled()) {
      return null;
    }

    const state = this.streams.get(dictationId);
    if (!state) {
      return null;
    }
    if (state.debugRecordingPath) {
      return state.debugRecordingPath;
    }
    if (state.debugAudioChunks.length === 0) {
      return null;
    }

    const pcmBuffer = Buffer.concat(state.debugAudioChunks);
    const wavBuffer = convertPCMToWavBuffer(
      pcmBuffer,
      state.outputRate,
      PCM_CHANNELS,
      PCM_BITS_PER_SAMPLE,
    );
    const path = await this.debug.persistAudio(
      wavBuffer,
      { sessionId: state.sessionId, dictationId: state.dictationId, format: "audio/wav" },
      this.logger,
      state.debugChunkWriter?.folder,
    );
    state.debugRecordingPath = path;
    return path;
  }

  private failDictationStream(dictationId: string, error: string, retryable: boolean): void {
    this.emit({
      type: "dictation_stream_error",
      payload: { dictationId, error, retryable },
    });
  }

  private async failAndCleanupDictationStream(
    dictationId: string,
    error: string,
    retryable: boolean,
  ): Promise<void> {
    const debugRecordingPath = await this.maybePersistDictationStreamAudio(dictationId);
    this.emit({
      type: "dictation_stream_error",
      payload: {
        dictationId,
        error,
        retryable,
        ...(debugRecordingPath ? { debugRecordingPath } : {}),
      },
    });
    if (debugRecordingPath) {
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "system",
          content: `Saved dictation audio: ${debugRecordingPath}`,
          metadata: { recordingPath: debugRecordingPath, dictationId },
        },
      });
    }
    this.cleanupDictationStream(dictationId);
  }

  private cleanupDictationStream(dictationId: string): void {
    const state = this.streams.get(dictationId) ?? null;
    if (!state) {
      return;
    }
    if (state.finalTimeout) {
      clearTimeout(state.finalTimeout);
    }
    try {
      state.stt.close();
    } catch {
      // no-op
    }
    this.streams.delete(dictationId);
  }

  private estimateFinalizationTimeout(state: DictationStreamState): {
    timeoutMs: number;
    pendingSegments: number;
    pendingAudioSeconds: number;
    missingSeqCount: number;
  } {
    const bytesPerSecond = Math.max(1, state.outputRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8));
    const pendingCommittedSegments = state.committedSegmentIds.reduce((count, segmentId) => {
      return state.finalTranscriptSegmentIds.has(segmentId) ? count : count + 1;
    }, 0);
    const committedSet = new Set(state.committedSegmentIds);
    const pendingUncommittedTranscriptSegments = Array.from(
      state.transcriptsBySegmentId.keys(),
    ).reduce((count, segmentId) => {
      if (committedSet.has(segmentId)) {
        return count;
      }
      return state.finalTranscriptSegmentIds.has(segmentId) ? count : count + 1;
    }, 0);
    const pendingSegments =
      pendingCommittedSegments +
      state.pendingBackgroundCommitAcknowledgements +
      pendingUncommittedTranscriptSegments +
      (state.awaitingFinalCommit ? 1 : 0);
    const pendingAudioSeconds = Math.ceil(Math.max(0, state.bytesSinceCommit) / bytesPerSecond);
    const missingSeqCount =
      state.finalSeq === null ? 0 : Math.max(0, state.finalSeq - state.ackSeq);

    const extraMs =
      pendingSegments * DICTATION_FINAL_TIMEOUT_PER_PENDING_SEGMENT_MS +
      pendingAudioSeconds * DICTATION_FINAL_TIMEOUT_PER_PENDING_AUDIO_SECOND_MS +
      missingSeqCount * DICTATION_FINAL_TIMEOUT_PER_MISSING_SEQ_MS;

    const timeoutMs = Math.max(
      this.finalTimeoutMs,
      Math.min(DICTATION_FINAL_TIMEOUT_MAX_MS, this.finalTimeoutMs + extraMs),
    );

    return {
      timeoutMs,
      pendingSegments,
      pendingAudioSeconds,
      missingSeqCount,
    };
  }

  private appendDictationAudio(state: DictationStreamState, pcm16: Buffer): void {
    let offset = 0;
    while (offset < pcm16.length) {
      const remainingBeforeCommit =
        state.backgroundCommitBytes > 0
          ? state.backgroundCommitBytes - state.bytesSinceCommit
          : pcm16.length - offset;
      const end = Math.min(pcm16.length, offset + remainingBeforeCommit);
      const pending = pcm16.subarray(offset, end);

      state.stt.appendPcm16(pending);
      state.debugAudioChunks.push(pending);
      state.bytesSinceCommit += pending.length;
      state.peakSinceCommit = Math.max(state.peakSinceCommit, pcm16lePeakAbs(pending));
      offset = end;

      if (
        !state.finishRequested &&
        state.backgroundCommitBytes > 0 &&
        state.bytesSinceCommit >= state.backgroundCommitBytes
      ) {
        this.commitDictationSegment(state);
      }
    }
  }

  private commitDictationSegment(state: DictationStreamState): void {
    if (state.peakSinceCommit === 0) {
      state.stt.clear();
    } else {
      state.pendingBackgroundCommitAcknowledgements += 1;
      try {
        state.stt.commit();
      } catch (error) {
        state.pendingBackgroundCommitAcknowledgements -= 1;
        throw error;
      }
    }

    state.bytesSinceCommit = 0;
    state.peakSinceCommit = 0;
  }

  private maybeSealDictationStreamFinish(dictationId: string): void {
    const state = this.streams.get(dictationId);
    if (!state) {
      return;
    }
    if (!state.finishRequested || state.finalSeq === null) {
      return;
    }
    if (state.ackSeq < state.finalSeq) {
      return;
    }
    if (state.finishSealed) {
      return;
    }

    if (state.bytesSinceCommit > 0) {
      if (state.peakSinceCommit === 0) {
        this.logger.debug(
          {
            dictationId,
            bytesSinceCommit: state.bytesSinceCommit,
            peakSinceCommit: state.peakSinceCommit,
          },
          "Dictation finish: clearing all-zero PCM tail (skip final commit)",
        );
        state.stt.clear();
        state.bytesSinceCommit = 0;
        state.peakSinceCommit = 0;
        state.awaitingFinalCommit = false;
      } else {
        state.awaitingFinalCommit = true;
        try {
          state.stt.commit();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void this.failAndCleanupDictationStream(dictationId, message, true);
          return;
        }
      }
    } else {
      state.awaitingFinalCommit = false;
    }

    state.finishSealed = true;
  }
  private async persistAndEmitDictationStreamFinal(
    state: DictationStreamState,
    text: string,
  ): Promise<void> {
    if (state.finalizing) {
      return;
    }
    state.finalizing = true;
    if (state.finalTimeout) {
      clearTimeout(state.finalTimeout);
      state.finalTimeout = null;
    }

    let debugRecordingPath: string | null = null;
    try {
      debugRecordingPath = await this.maybePersistDictationStreamAudio(state.dictationId);
    } catch (error) {
      this.logger.warn(
        { dictationId: state.dictationId, err: error },
        "Failed to persist dictation debug audio",
      );
    }
    if (this.streams.get(state.dictationId) !== state) {
      return;
    }

    this.emit({
      type: "dictation_stream_final",
      payload: {
        dictationId: state.dictationId,
        text,
        ...(debugRecordingPath ? { debugRecordingPath } : {}),
      },
    });
    if (debugRecordingPath) {
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "system",
          content: `Saved dictation audio: ${debugRecordingPath}`,
          metadata: { recordingPath: debugRecordingPath, dictationId: state.dictationId },
        },
      });
    }
    this.cleanupDictationStream(state.dictationId);
  }

  private maybeFinalizeDictationStream(dictationId: string): void {
    const state = this.streams.get(dictationId);
    if (!state) {
      return;
    }

    if (!state.finishRequested || state.finalSeq === null) {
      return;
    }
    if (state.ackSeq < state.finalSeq) {
      return;
    }
    if (state.awaitingFinalCommit) {
      return;
    }
    if (state.pendingBackgroundCommitAcknowledgements > 0) {
      return;
    }

    const committedSet = new Set(state.committedSegmentIds);
    const orderedSegmentIds: string[] = [...state.committedSegmentIds];
    for (const segmentId of state.transcriptsBySegmentId.keys()) {
      if (!committedSet.has(segmentId)) {
        orderedSegmentIds.push(segmentId);
      }
    }

    if (orderedSegmentIds.length === 0) {
      void this.persistAndEmitDictationStreamFinal(state, "");
      return;
    }

    const allTranscriptsReady = orderedSegmentIds.every((segmentId) =>
      state.finalTranscriptSegmentIds.has(segmentId),
    );
    if (!allTranscriptsReady) {
      return;
    }

    const orderedText = joinTranscriptSegments(
      orderedSegmentIds.map((segmentId) => state.transcriptsBySegmentId.get(segmentId) ?? ""),
    );

    void this.persistAndEmitDictationStreamFinal(state, orderedText);
  }
}

function isBufferTooSmallError(message: string): boolean {
  return /buffer too small/i.test(message);
}
