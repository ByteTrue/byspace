/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { collabClient, runtimeState, runtimeVersion } = vi.hoisted(() => ({
  collabClient: {
    collabSliceCreate: vi.fn(),
    collabSliceList: vi.fn(),
  },
  runtimeState: {
    hosts: [] as { serverId: string; label: string }[],
    connectionStatus: "online" as string,
  },
  runtimeVersion: { value: 0 },
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => runtimeState.hosts,
    getSnapshot: (serverId: string) =>
      runtimeState.hosts.some((host) => host.serverId === serverId)
        ? { connectionStatus: runtimeState.connectionStatus }
        : null,
    getClient: (serverId: string) =>
      runtimeState.hosts.some((host) => host.serverId === serverId) ? collabClient : null,
    subscribeAll: () => () => {},
    getVersion: () => runtimeVersion.value,
  }),
  useHosts: () => runtimeState.hosts,
}));

vi.mock("react-native", () => ({
  ScrollView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("span", { "data-testid": testID }, children),
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("react-native-unistyles", () => {
  const fakeTheme = {
    colors: {
      background: "#000",
      foreground: "#fff",
      foregroundMuted: "#999",
      border: "#333",
    },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderRadius: { md: 6, lg: 8 },
  };
  return {
    StyleSheet: {
      create: (factory: unknown) => (typeof factory === "function" ? factory(fakeTheme) : factory),
    },
  };
});

vi.mock("lucide-react-native", () => ({
  Plus: () => React.createElement("span", { "data-icon": "Plus" }),
  RefreshCw: () => React.createElement("span", { "data-icon": "RefreshCw" }),
}));

vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
  }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": testID, onClick: onPress, disabled },
      children,
    ),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-testid": "collab-spinner" }),
}));

vi.mock("@/components/ui/text-input", () => ({
  EditingTextInput: (props: Record<string, unknown>) =>
    React.createElement("input", { "data-testid": props.testID }),
}));

vi.mock("@/components/headers/menu-header", () => ({
  MenuHeader: ({ title }: { title: string }) =>
    React.createElement("div", { "data-testid": "collab-header" }, title),
}));

import { CollabScreen } from "./collab-screen";

let root: Root;
let container: HTMLElement;

async function renderScreen(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CollabScreen));
  });
  // Flush the async load effect (promise resolution + state update).
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  runtimeState.hosts = [{ serverId: "srv-1", label: "Dev" }];
  runtimeState.connectionStatus = "online";
  vi.mocked(collabClient.collabSliceList).mockResolvedValue({
    requestId: "req",
    records: [],
    error: null,
  });
  vi.mocked(collabClient.collabSliceCreate).mockResolvedValue({
    requestId: "req",
    record: null,
    error: null,
  });
});

afterEach(() => {
  root?.unmount();
  container?.remove();
  vi.clearAllMocks();
});

function findByTestId(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

describe("CollabScreen", () => {
  it("renders the entry with an empty list for a connected host", async () => {
    await renderScreen();
    expect(findByTestId("collab-header")).not.toBeNull();
    expect(findByTestId("collab-empty")).not.toBeNull();
    expect(collabClient.collabSliceList).toHaveBeenCalled();
  });

  it("creates a record and refreshes the list", async () => {
    vi.mocked(collabClient.collabSliceCreate).mockImplementation(async () => {
      vi.mocked(collabClient.collabSliceList).mockResolvedValue({
        requestId: "req",
        records: [
          {
            id: "9f1c8b1e-0c1d-4a5b-8e2f-3a4b5c6d7e8f",
            title: "From test",
            createdAt: "2026-09-26T16:00:00.000Z",
            updatedAt: "2026-09-26T16:00:00.000Z",
          },
        ],
        error: null,
      });
      return { requestId: "req", record: null, error: null };
    });

    await renderScreen();
    const create = findByTestId("collab-create") as HTMLButtonElement;
    expect(create).not.toBeNull();
    await act(async () => {
      create.click();
    });
    expect(collabClient.collabSliceCreate).toHaveBeenCalledWith({ title: "Untitled slice record" });
    expect(findByTestId("collab-record-row")).not.toBeNull();
    expect(container.textContent).toContain("From test");
  });

  it("shows a connecting state when no host is online", async () => {
    runtimeState.connectionStatus = "connecting";
    await renderScreen();
    expect(findByTestId("collab-spinner")).not.toBeNull();
  });
});
