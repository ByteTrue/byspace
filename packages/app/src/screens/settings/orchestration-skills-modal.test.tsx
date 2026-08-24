import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestrationSkillsModal } from "./orchestration-skills-modal";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 0.5: 2, 1: 4, 2: 8, 2.5: 10, 3: 12, 4: 16, 6: 24 },
    fontSize: { sm: 13, base: 15, xs: 11 },
    fontWeight: { medium: "500", semibold: "600" },
    borderRadius: { md: 6, lg: 8, xl: 12 },
    borderWidth: { 1: 1 },
    opacity: { 50: 0.5 },
    colors: {
      surface0: "#111",
      surface1: "#181818",
      surface2: "#222",
      surface3: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      statusDanger: "#ef4444",
      palette: { zinc: { 600: "#52525b" } },
    },
  },
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (values: Record<string, unknown>) => values.web ?? values.default,
  },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    accessibilityRole,
    accessibilityState,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityRole?: string;
    accessibilityState?: { checked?: boolean };
    testID?: string;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": testID,
        role: accessibilityRole,
        "aria-checked": accessibilityState?.checked,
        onClick: onPress,
      },
      children,
    ),
}));

vi.mock("lucide-react-native", () => ({
  Check: () => null,
  Sparkles: () => null,
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  Info: () => null,
  XCircle: () => null,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    testID,
  }: {
    value: boolean;
    onValueChange?: (v: boolean) => void;
    testID?: string;
  }) =>
    React.createElement("input", {
      type: "checkbox",
      checked: value,
      onChange: (e: { target: { checked: boolean } }) => onValueChange?.(e.target.checked),
      "data-testid": testID,
    }),
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    header,
    children,
    onClose,
    testID,
  }: {
    visible: boolean;
    header?: { title?: string };
    children: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) => {
    if (!visible) return null;
    return ReactModule.createElement(
      "div",
      { "data-testid": testID ?? "adaptive-modal-sheet", "data-title": header?.title },
      ReactModule.createElement(
        "button",
        { type: "button", "data-testid": "sheet-close", onClick: onClose },
        "Close",
      ),
      children,
    );
  };
  return { AdaptiveModalSheet };
});

describe("OrchestrationSkillsModal", () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
      url: "http://localhost",
    });
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    container = dom.window.document.getElementById("root") as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    vi.unstubAllGlobals();
  });

  it("renders target switches and skill rows when visible", () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();

    act(() => {
      root.render(
        <OrchestrationSkillsModal
          visible={true}
          onClose={onClose}
          onSave={onSave}
          isSaving={false}
        />,
      );
    });

    expect(container.querySelector("[data-testid='orchestration-skills-modal']")).not.toBeNull();
    expect(container.querySelector("[data-testid='skill-row-byspace']")).not.toBeNull();
    expect(container.querySelector("[data-testid='skill-row-byspace-advisor']")).not.toBeNull();
    expect(container.querySelector("[data-testid='skill-row-byspace-committee']")).not.toBeNull();
    expect(container.querySelector("[data-testid='skill-row-byspace-handoff']")).not.toBeNull();
    expect(
      container.querySelector("[data-testid='skill-row-byspace-project-setup']"),
    ).not.toBeNull();
  });

  it("handles save with selected skills and targets", async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();

    act(() => {
      root.render(
        <OrchestrationSkillsModal
          visible={true}
          onClose={onClose}
          onSave={onSave}
          isSaving={false}
        />,
      );
    });

    const saveBtn = container.querySelector("[data-testid='orchestration-skills-save-btn']");
    expect(saveBtn).not.toBeNull();

    await act(async () => {
      saveBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledWith({
      skillNames: expect.arrayContaining([
        "byspace",
        "byspace-advisor",
        "byspace-committee",
        "byspace-handoff",
        "byspace-project-setup",
      ]),
      targets: expect.arrayContaining(["agents", "claude"]),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("handles deselecting all skills and saving (uninstall)", async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();

    act(() => {
      root.render(
        <OrchestrationSkillsModal
          visible={true}
          onClose={onClose}
          onSave={onSave}
          isSaving={false}
        />,
      );
    });

    // Click deselect all skills
    const toggleAllBtn = container.querySelector("[data-testid='toggle-all-skills-button']");
    expect(toggleAllBtn).not.toBeNull();
    await act(async () => {
      toggleAllBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    const saveBtn = container.querySelector("[data-testid='orchestration-skills-save-btn']");
    expect(saveBtn).not.toBeNull();

    await act(async () => {
      saveBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledWith({
      skillNames: [],
      targets: expect.arrayContaining(["agents", "claude"]),
    });
    expect(onClose).toHaveBeenCalled();
  });
});
