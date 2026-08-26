import { useEffect, useRef } from "react";
import { AppState } from "react-native";
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
  onUserActivity: () => void;
  onAppResumed?: (awayMs: number) => void;
  onWindowFocused?: () => void;
}

export function useClientActivity({
  client,
  focusedAgentId,
  focusedTerminalId,
  onUserActivity,
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
      deviceType: "mobile",
      initialFocusedAgentId: focusedAgentId,
      initialFocusedTerminalId: focusedTerminalId,
      initialAppVisible: AppState.currentState === "active",
      now: () => Date.now(),
      onUserActivity,
      onAppResumed: (awayMs) => onAppResumedRef.current?.(awayMs),
    });
  }
  const tracker = trackerRef.current;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const visible = state === "active";
      const { changed } = tracker.notifyAppVisibility(visible);
      if (changed && visible) {
        tracker.maybeSendImmediateHeartbeat();
        onWindowFocusedRef.current?.();
      }
    });
    return () => subscription.remove();
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
