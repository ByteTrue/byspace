export interface DictationRefinementMeta {
  requestId: string;
  originalText?: string;
}

import { i18n } from "@/i18n/i18next";

export type DictationStatus = "idle" | "recording" | "uploading" | "failed";

export interface UseDictationOptions {
  client: import("@bytetrue/byspace-client/internal/daemon-client").DaemonClient | null;
  onTranscript: (text: string, meta: DictationRefinementMeta) => void;
  onError?: (error: Error) => void;
  refineTranscript?: (text: string) => Promise<{ text: string; refined: boolean }>;
  onPermanentFailure?: (error: Error, context: { requestId: string }) => void;
  canStart?: () => boolean;
  canConfirm?: () => boolean;
  enableDuration?: boolean;
}

export interface UseDictationResult {
  isRecording: boolean;
  isRecordingActive: () => boolean;
  isDictationActive: () => boolean;
  isProcessing: boolean;
  volume: number;
  duration: number;
  error: string | null;
  status: DictationStatus;
  startDictation: () => Promise<void>;
  cancelDictation: () => Promise<void>;
  confirmDictation: () => Promise<void>;
  retryFailedDictation: () => Promise<void>;
  discardFailedDictation: () => void;
  reset: () => void;
}

export const DURATION_TICK_MS = 1000;
export const PCM_DICTATION_FORMAT = "audio/pcm;rate=16000;bits=16";

export const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return new Error(error);
  }
  return new Error(i18n.t("common.errors.unexpectedDictationError"));
};
