import { create } from "zustand";
import type { OpenedPortForward, PortForwardClient } from "./port-forward-service";

export type PortForwardRuntimeStatus = "active" | "stopping";

export interface TrackedPortForward extends OpenedPortForward {
  status: PortForwardRuntimeStatus;
}

interface PortForwardRuntimeState {
  forwards: TrackedPortForward[];
}

interface Tracker {
  client: PortForwardClient;
  forwardId: string;
  unsubscribe: () => void;
}

const trackers = new Map<string, Tracker>();

export const usePortForwardRuntimeStore = create<PortForwardRuntimeState>(() => ({ forwards: [] }));

export function portForwardKey(forward: Pick<OpenedPortForward, "sourceServerId" | "forwardId">) {
  return `${forward.sourceServerId}:${forward.forwardId}`;
}

function updateForward(key: string, update: (forward: TrackedPortForward) => TrackedPortForward) {
  usePortForwardRuntimeStore.setState((state) => ({
    forwards: state.forwards.map((forward) =>
      portForwardKey(forward) === key ? update(forward) : forward,
    ),
  }));
}

function removeForward(key: string): void {
  const tracker = trackers.get(key);
  if (tracker) {
    trackers.delete(key);
    tracker.unsubscribe();
  }
  usePortForwardRuntimeStore.setState((state) => ({
    forwards: state.forwards.filter((forward) => portForwardKey(forward) !== key),
  }));
}

export function trackPortForward(forward: OpenedPortForward, client: PortForwardClient): void {
  const key = portForwardKey(forward);
  removeForward(key);

  const tracker: Tracker = {
    client,
    forwardId: forward.forwardId,
    unsubscribe: () => undefined,
  };
  trackers.set(key, tracker);
  usePortForwardRuntimeStore.setState((state) => ({
    forwards: [...state.forwards, { ...forward, status: "active" }],
  }));

  const unsubscribe = client.subscribeConnectionStatus((connection) => {
    if (!trackers.has(key)) return;
    if (connection.status === "disconnected" || connection.status === "disposed") {
      removeForward(key);
    }
  });
  if (!trackers.has(key)) {
    unsubscribe();
    return;
  }
  tracker.unsubscribe = unsubscribe;
}

export async function stopTrackedPortForward(key: string): Promise<void> {
  const tracker = trackers.get(key);
  if (!tracker) {
    removeForward(key);
    return;
  }
  const previousStatus =
    usePortForwardRuntimeStore
      .getState()
      .forwards.find((forward) => portForwardKey(forward) === key)?.status ?? "active";
  updateForward(key, (current) => ({ ...current, status: "stopping" }));
  try {
    await tracker.client.closeRemoteTcpForward(tracker.forwardId);
  } catch (error) {
    updateForward(key, (current) => ({ ...current, status: previousStatus }));
    throw error;
  }
  removeForward(key);
}

export function resetPortForwardRuntimeStore(): void {
  for (const key of trackers.keys()) removeForward(key);
  usePortForwardRuntimeStore.setState({ forwards: [] });
}
