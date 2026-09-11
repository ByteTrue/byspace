/**
 * Dictation shim (voice retired, issue 025 C8).
 *
 * Dictation never starts; these no-ops keep the composer's dictation UI
 * permanently closed.
 */

export interface UseDictationReturn {
  isListening: false;
  isSupported: false;
  isRecording: false;
  isRecordingActive: false;
  isProcessing: false;
  partialTranscript: null;
  volume: 0;
  duration: 0;
  error: null;
  status: "idle";
  errorText: null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  startDictation: () => void;
  retryFailedDictation: () => void;
  discardFailedDictation: () => void;
  confirmDictation: () => void;
  cancelDictation: () => void;
}

export function useDictation(_input?: Record<string, unknown>): UseDictationReturn {
  return {
    isListening: false,
    isSupported: false,
    isRecording: false,
    isRecordingActive: false,
    isProcessing: false,
    partialTranscript: null,
    volume: 0,
    duration: 0,
    error: null,
    status: "idle",
    errorText: null,
    start: () => undefined,
    stop: () => undefined,
    toggle: () => undefined,
    startDictation: () => undefined,
    retryFailedDictation: () => undefined,
    discardFailedDictation: () => undefined,
    confirmDictation: () => undefined,
    cancelDictation: () => undefined,
  };
}
