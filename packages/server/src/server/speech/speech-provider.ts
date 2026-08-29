import type pino from "pino";

export interface LogprobToken {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionCommittedEvent {
  segmentId: string;
  previousSegmentId: string | null;
}

export interface StreamingTranscriptionEvent {
  segmentId: string;
  transcript: string;
  isFinal: boolean;
  language?: string;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionSession {
  /**
   * Required PCM16LE sample rate for `appendPcm16()`.
   * Callers are responsible for resampling before appending.
   */
  requiredSampleRate: number;

  connect(): Promise<void>;
  appendPcm16(pcm16le: Buffer): void;
  commit(): void;
  clear(): void;
  close(): void;

  on(event: "committed", handler: (payload: StreamingTranscriptionCommittedEvent) => void): unknown;
  on(event: "transcript", handler: (payload: StreamingTranscriptionEvent) => void): unknown;
  on(event: "error", handler: (err: unknown) => void): unknown;
}

export interface SpeechToTextProvider {
  /** Optional model-specific cap for invisible background commits during long dictation. */
  dictationBackgroundCommitSeconds?: number;
  id: "local";
  createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession;
}
