import { useEffect, useRef } from "react";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import {
  type ClientActivityTracker,
  createClientActivityTracker,
  HEARTBEAT_INTERVAL_MS,
} from "./client-activity-tracker";

interface ClientActivityOptions {
  client: DaemonClient;
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
  onAppResumed?: (awayMs: number) => void;
  onWindowFocused?: () => void;
}

export function useClientActivity({
  client,
  focusedAgentId,
  focusedTerminalId,
  onAppResumed,
  onWindowFocused,
}: ClientActivityOptions): void {
  const onAppResumedRef = useRef(onAppResumed);
  onAppResumedRef.current = onAppResumed;
  const onWindowFocusedRef = useRef(onWindowFocused);
  onWindowFocusedRef.current = onWindowFocused;
  const trackerRef = useRef<ClientActivityTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createClientActivityTracker({
      client,
      deviceType: "web",
      initialFocusedAgentId: focusedAgentId,
      initialFocusedTerminalId: focusedTerminalId,
      initialAppVisible: document.visibilityState === "visible",
      now: () => Date.now(),
      onAppResumed: (awayMs) => onAppResumedRef.current?.(awayMs),
    });
  }
  const tracker = trackerRef.current;

  useEffect(() => {
    const handleUserActivity = () => {
      tracker.recordUserActivity();
      tracker.maybeSendImmediateHeartbeat();
    };
    const handleWindowFocus = () => {
      handleUserActivity();
      onWindowFocusedRef.current?.();
    };
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      const { changed } = tracker.notifyAppVisibility(visible);
      if (changed && visible) tracker.maybeSendImmediateHeartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pointerdown", handleUserActivity, { passive: true });
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("wheel", handleUserActivity, { passive: true });
    window.addEventListener("touchstart", handleUserActivity, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pointerdown", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("wheel", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
    };
  }, [tracker]);

  useEffect(() => tracker.setFocusedAgentId(focusedAgentId), [focusedAgentId, tracker]);
  useEffect(() => tracker.setFocusedTerminalId(focusedTerminalId), [focusedTerminalId, tracker]);
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };
    const start = () => {
      stop();
      tracker.sendHeartbeat();
      intervalId = setInterval(() => tracker.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    };
    const unsubscribe = client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") start();
      else stop();
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [client, tracker]);
}
