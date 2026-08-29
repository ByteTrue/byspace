import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { useDictationAudioSource } from "@/hooks/use-dictation-audio-source";
import { generateMessageId } from "@/types/stream";
import { AttemptGuard } from "@/utils/attempt-guard";
import {
  DURATION_TICK_MS,
  PCM_DICTATION_FORMAT,
  toError,
  type DictationRefinementResult,
  type DictationStatus,
  type UseDictationOptions,
  type UseDictationResult,
} from "./use-dictation.shared";

export function useDictation(options: UseDictationOptions): UseDictationResult {
  const { t } = useTranslation();
  const { client, onTranscript, refineTranscript, onError, canStart, canConfirm } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DictationStatus>("idle");

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const refineTranscriptRef = useRef(refineTranscript);
  useEffect(() => {
    refineTranscriptRef.current = refineTranscript;
  }, [refineTranscript]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  const isRecordingActive = useCallback(() => isRecordingRef.current, []);

  const isProcessingRef = useRef(isProcessing);
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);
  const isDictationActive = useCallback(
    () => isRecordingRef.current || isProcessingRef.current,
    [],
  );

  // duration is used for UI only; no need to mirror into a ref.

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptGuardRef = useRef(new AttemptGuard());
  const actionGateRef = useRef<{ starting: boolean; confirming: boolean; cancelling: boolean }>({
    starting: false,
    confirming: false,
    cancelling: false,
  });

  const senderRef = useRef<DictationStreamSender | null>(null);
  if (!senderRef.current) {
    senderRef.current = new DictationStreamSender({
      client,
      format: PCM_DICTATION_FORMAT,
      createDictationId: generateMessageId,
    });
  }
  useEffect(() => {
    senderRef.current?.setClient(client);
  }, [client]);

  const stopDurationTracking = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const startDurationTracking = useCallback(() => {
    if (durationIntervalRef.current) {
      return;
    }
    durationIntervalRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, DURATION_TICK_MS);
  }, []);

  const reportError = useCallback(
    (err: unknown, context?: string) => {
      const normalized = toError(err);
      if (normalized.name === "AttemptCancelledError") {
        return;
      }
      if (context) {
        console.error(`[useDictation] ${context}`, normalized);
      } else {
        console.error("[useDictation]", normalized);
      }
      setError(normalized.message);
      onErrorRef.current?.(normalized);
    },
    [setError],
  );

  const clearStreamingState = useCallback(() => {
    senderRef.current?.clearAll();
  }, []);

  const startNewStream = useCallback(async () => {
    await senderRef.current?.restartStream("new-recording");
  }, []);

  const ensureFinalTranscript = useCallback(async (finalSeq: number): Promise<string> => {
    const result = await senderRef.current!.finish(finalSeq);
    return result.text;
  }, []);

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.subscribeConnectionStatus((next) => {
      if (next.status !== "connected") {
        return;
      }
      if (!isRecordingRef.current) {
        return;
      }
      void startNewStream().catch((err) => {
        reportError(err, "Failed to restart dictation stream after reconnect");
      });
    });
  }, [client, reportError, startNewStream]);

  const handleStreamingTranscriptionSuccess = useCallback(
    (text: string, requestId: string, originalText?: string, refinementError?: string) => {
      setIsProcessing(false);
      isProcessingRef.current = false;
      setDuration(0);
      setStatus("idle");

      const transcriptText = text.trim();
      clearStreamingState();

      if (!transcriptText) {
        return;
      }
      onTranscriptRef.current?.(transcriptText, {
        requestId,
        ...(originalText ? { originalText } : {}),
        ...(refinementError ? { error: refinementError } : {}),
      });
    },
    [clearStreamingState],
  );

  const completeTranscript = useCallback(
    async (transcriptText: string, attemptId: number) => {
      const refinement: DictationRefinementResult = refineTranscriptRef.current
        ? await refineTranscriptRef.current(transcriptText).catch((refinementError) => {
            const normalized = toError(refinementError);
            console.warn(
              "[useDictation] Transcript refinement failed; using raw transcript",
              normalized,
            );
            return { text: transcriptText, refined: false, error: normalized.message };
          })
        : { text: transcriptText, refined: false };
      attemptGuardRef.current.assertCurrent(attemptId);
      handleStreamingTranscriptionSuccess(
        refinement.text,
        generateMessageId(),
        refinement.refined ? transcriptText : undefined,
        refinement.error,
      );
    },
    [handleStreamingTranscriptionSuccess],
  );

  const handleDictationFailure = useCallback(
    (failure: unknown) => {
      const normalized = toError(failure);
      stopDurationTracking();
      setIsProcessing(false);
      isProcessingRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);

      if (senderRef.current?.hasSegments()) {
        setStatus("failed");
      } else {
        setStatus("idle");
      }

      reportError(normalized, "Failed to complete dictation");
    },
    [reportError, stopDurationTracking],
  );

  const audio = useDictationAudioSource({
    onPcmSegment: (audioData) => {
      senderRef.current?.enqueueSegment(audioData);
    },
    onError: (err) => {
      onErrorRef.current?.(err);
    },
    onInterruption: () => {
      try {
        senderRef.current?.cancel();
      } catch {
        // no-op
      }
      handleDictationFailure(new Error("Dictation was interrupted by another audio source."));
    },
  });
  const audioStopRef = useRef(audio.stop);
  useEffect(() => {
    audioStopRef.current = audio.stop;
  }, [audio.stop]);

  const startDictation = useCallback(async () => {
    if (
      actionGateRef.current.starting ||
      actionGateRef.current.confirming ||
      actionGateRef.current.cancelling
    ) {
      return;
    }
    if (isRecordingRef.current || isProcessingRef.current) {
      return;
    }
    const startAllowed = canStart ? canStart() : true;
    if (!startAllowed) {
      return;
    }

    actionGateRef.current.starting = true;
    const attemptId = attemptGuardRef.current.next();
    setError(null);
    setDuration(0);
    setIsProcessing(false);
    setStatus("recording");
    clearStreamingState();

    try {
      await audio.start();
      attemptGuardRef.current.assertCurrent(attemptId);
      isRecordingRef.current = true;
      setIsRecording(true);
      startDurationTracking();
      if (client?.isConnected) {
        await startNewStream();
      }
    } catch (err) {
      await audio.stop().catch(() => undefined);
      if (!attemptGuardRef.current.isCurrent(attemptId)) {
        return;
      }
      stopDurationTracking();
      isRecordingRef.current = false;
      setIsRecording(false);
      setStatus("idle");
      reportError(err, "Failed to start dictation");
    } finally {
      actionGateRef.current.starting = false;
    }
  }, [
    audio,
    canStart,
    clearStreamingState,
    client,
    reportError,
    startDurationTracking,
    startNewStream,
    stopDurationTracking,
  ]);

  const cancelDictation = useCallback(async () => {
    attemptGuardRef.current.cancel();
    if (actionGateRef.current.cancelling) {
      return;
    }
    if (!isRecordingRef.current && !isProcessingRef.current) {
      return;
    }
    actionGateRef.current.cancelling = true;
    stopDurationTracking();
    setDuration(0);
    setError(null);

    try {
      try {
        senderRef.current?.cancel();
      } catch {
        // no-op
      }
      await audio.stop();
    } catch (err) {
      reportError(err, "Failed to cancel dictation");
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
      setIsProcessing(false);
      isProcessingRef.current = false;
      setStatus("idle");
      clearStreamingState();
      actionGateRef.current.cancelling = false;
      actionGateRef.current.confirming = false;
    }
  }, [audio, clearStreamingState, reportError, stopDurationTracking]);

  const confirmDictation = useCallback(async () => {
    if (actionGateRef.current.confirming) {
      return;
    }
    if (!isRecordingRef.current || isProcessingRef.current) {
      return;
    }
    const confirmAllowed = canConfirm ? canConfirm() : true;
    if (!confirmAllowed) {
      return;
    }

    actionGateRef.current.confirming = true;
    setError(null);
    stopDurationTracking();
    setIsProcessing(true);
    isProcessingRef.current = true;

    const attemptId = attemptGuardRef.current.next();

    try {
      await audio.stop();
      attemptGuardRef.current.assertCurrent(attemptId);

      setStatus("uploading");
      isRecordingRef.current = false;
      setIsRecording(false);

      const finalSeq = senderRef.current?.getFinalSeq() ?? -1;
      if (finalSeq < 0) {
        handleStreamingTranscriptionSuccess("", generateMessageId());
        return;
      }

      const transcriptText = await ensureFinalTranscript(finalSeq);
      attemptGuardRef.current.assertCurrent(attemptId);
      await completeTranscript(transcriptText, attemptId);
    } catch (err) {
      if (!attemptGuardRef.current.isCurrent(attemptId)) return;
      handleDictationFailure(err);
    } finally {
      if (attemptGuardRef.current.isCurrent(attemptId)) {
        actionGateRef.current.confirming = false;
      }
    }
  }, [
    audio,
    canConfirm,
    completeTranscript,
    handleDictationFailure,
    handleStreamingTranscriptionSuccess,
    stopDurationTracking,
    ensureFinalTranscript,
  ]);

  const retryFailedDictation = useCallback(async () => {
    if (!senderRef.current?.hasSegments() || actionGateRef.current.confirming) {
      return;
    }
    actionGateRef.current.confirming = true;
    const attemptId = attemptGuardRef.current.next();
    setError(null);
    setStatus("uploading");
    setIsProcessing(true);
    isProcessingRef.current = true;

    try {
      if (!client?.isConnected) {
        throw new Error(t("common.errors.daemonClientDisconnected"));
      }
      senderRef.current.resetStreamForReplay();
      const finalSeq = senderRef.current.getFinalSeq();
      const text = await ensureFinalTranscript(finalSeq);
      attemptGuardRef.current.assertCurrent(attemptId);
      await completeTranscript(text, attemptId);
    } catch (err) {
      if (!attemptGuardRef.current.isCurrent(attemptId)) return;
      handleDictationFailure(err);
    } finally {
      if (attemptGuardRef.current.isCurrent(attemptId)) {
        actionGateRef.current.confirming = false;
      }
    }
  }, [client, completeTranscript, ensureFinalTranscript, handleDictationFailure, t]);

  const discardFailedDictation = useCallback(() => {
    setIsProcessing(false);
    isProcessingRef.current = false;
    setDuration(0);
    setStatus("idle");
    setError(null);
    clearStreamingState();
  }, [clearStreamingState]);

  useEffect(() => {
    const attemptGuard = attemptGuardRef.current;
    const audioStop = audioStopRef;
    return () => {
      attemptGuard.cancel();
      try {
        senderRef.current?.cancel();
      } catch {
        // no-op
      }
      stopDurationTracking();
      void audioStop.current().catch(() => undefined);
      senderRef.current?.dispose();
    };
  }, [stopDurationTracking]);

  return {
    isRecording,
    isRecordingActive,
    isDictationActive,
    isProcessing,
    volume: audio.volume,
    duration,
    error,
    status,
    startDictation,
    cancelDictation,
    confirmDictation,
    retryFailedDictation,
    discardFailedDictation,
  };
}

export type {
  DictationStatus,
  UseDictationOptions,
  UseDictationResult,
} from "./use-dictation.shared";
