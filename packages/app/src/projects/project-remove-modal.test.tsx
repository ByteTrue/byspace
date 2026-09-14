// @vitest-environment jsdom
import "@/test/window-local-storage";
import { i18n as testI18n } from "@/i18n/i18next";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRemoveModal } from "./project-remove-modal";

void testI18n;

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 2.5: 10, 3: 12 },
    fontSize: { sm: 13, base: 15 },
    borderRadius: { md: 6, full: 9999 },
    borderWidth: { 1: 1 },
    opacity: { 50: 0.5 },
    fontWeight: { normal: "400", medium: "500" },
    colors: {
      surface0: "#000",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      palette: { red: { 300: "#f87171" } },
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (comp: unknown) => comp,
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/components/host-status-dot", () => ({
  HostStatusDot: () => React.createElement("div", { "data-testid": "host-status-dot" }),
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    children,
    onClose,
    testID,
  }: {
    visible: boolean;
    children: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) => {
    if (!visible) return null;
    return ReactModule.createElement(
      "div",
      { "data-testid": testID ?? "adaptive-modal-sheet" },
      ReactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": "adaptive-modal-sheet-close",
          onClick: onClose,
        },
        "Close",
      ),
      children,
    );
  };
  return { AdaptiveModalSheet };
});

const mockToast = {
  error: vi.fn(),
  success: vi.fn(),
};

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => mockToast,
}));

const mockRemoveProjectFromHosts = vi.fn();
const mockGetCurrentProjectRemoveReadinessForTargets = vi.fn();

vi.mock("@/projects/project-remove", () => ({
  getCurrentProjectRemoveReadinessForTargets: (targets: unknown) =>
    mockGetCurrentProjectRemoveReadinessForTargets(targets),
  removeProjectFromHosts: (input: unknown) => mockRemoveProjectFromHosts(input),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [
    { serverId: "host-1", label: "Host One" },
    { serverId: "host-2", label: "Host Two" },
  ],
  getHostRuntimeStore: () => ({
    getClient: vi.fn(() => ({})),
  }),
}));

describe("ProjectRemoveModal", () => {
  let dom: JSDOM;
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: "http://localhost",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    container = dom.window.document.getElementById("root") as HTMLDivElement;
    root = createRoot(container);
    mockToast.error.mockReset();
    mockToast.success.mockReset();
    mockRemoveProjectFromHosts.mockReset();
    mockGetCurrentProjectRemoveReadinessForTargets.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it("renders buttons for each host and removes single host target on click", async () => {
    mockGetCurrentProjectRemoveReadinessForTargets.mockReturnValue({
      kind: "ready",
      targets: [{ serverId: "host-1", projectId: "prj-1" }],
    });
    mockRemoveProjectFromHosts.mockResolvedValue({
      kind: "removed",
      serverIds: ["host-1"],
    });

    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <ProjectRemoveModal
          visible={true}
          projectName="pi-package-mono"
          projectViewKey="prj_key"
          hosts={[
            { serverId: "host-1", projectId: "prj-1" },
            { serverId: "host-2", projectId: "prj-2" },
          ]}
          onClose={onClose}
        />,
      );
    });

    const host1Btn = container.querySelector(
      '[data-testid="project-remove-host-button-host-1"]',
    ) as HTMLElement;
    expect(host1Btn).not.toBeNull();

    await act(async () => {
      host1Btn.click();
    });

    expect(mockGetCurrentProjectRemoveReadinessForTargets).toHaveBeenCalledWith([
      { serverId: "host-1", projectId: "prj-1" },
    ]);
    expect(mockRemoveProjectFromHosts).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("removes all hosts when clicking all hosts button", async () => {
    mockGetCurrentProjectRemoveReadinessForTargets.mockReturnValue({
      kind: "ready",
      targets: [
        { serverId: "host-1", projectId: "prj-1" },
        { serverId: "host-2", projectId: "prj-2" },
      ],
    });
    mockRemoveProjectFromHosts.mockResolvedValue({
      kind: "removed",
      serverIds: ["host-1", "host-2"],
    });

    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <ProjectRemoveModal
          visible={true}
          projectName="pi-package-mono"
          projectViewKey="prj_key"
          hosts={[
            { serverId: "host-1", projectId: "prj-1" },
            { serverId: "host-2", projectId: "prj-2" },
          ]}
          onClose={onClose}
        />,
      );
    });

    const allBtn = container.querySelector(
      '[data-testid="project-remove-all-hosts-button"]',
    ) as HTMLElement;
    expect(allBtn).not.toBeNull();

    await act(async () => {
      allBtn.click();
    });

    expect(mockGetCurrentProjectRemoveReadinessForTargets).toHaveBeenCalledWith([
      { serverId: "host-1", projectId: "prj-1" },
      { serverId: "host-2", projectId: "prj-2" },
    ]);
    expect(mockRemoveProjectFromHosts).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
