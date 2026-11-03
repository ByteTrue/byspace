/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorkspaceTabMenuEntries } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { MobileTabTrailingAccessory } from "@/screens/workspace/workspace-tab-trailing-accessory";
import { TooltipProvider } from "~/components/ui/tooltip";

void testI18n;

const { mockTheme } = vi.hoisted(() => ({
  mockTheme: {
    colors: { foregroundMuted: "#aaa", surface2: "#222" },
    borderRadius: { md: 6 },
    fontSize: { xs: 11 },
  },
}));

vi.mock("lucide-react", () => {
  const StubIcon = () => null;
  return {
    ArrowLeftToLine: StubIcon,
    ArrowRightToLine: StubIcon,
    Copy: StubIcon,
    CopyX: StubIcon,
    Ellipsis: StubIcon,
    Pencil: StubIcon,
    RotateCw: StubIcon,
    X: StubIcon,
  };
});

vi.mock("~/app/theme-object", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/app/theme-object")>()),
  withTheme:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({
      themeProps,
      ...rest
    }: { themeProps?: (theme: unknown) => Record<string, unknown> } & Record<string, unknown>) => {
      const themed = themeProps ? themeProps(mockTheme) : {};
      return React.createElement(Component, { ...rest, ...themed });
    },
}));

function agentTab(): WorkspaceTabDescriptor {
  return {
    key: "agent_123",
    tabId: "agent_123",
    kind: "agent",
    target: { kind: "agent", agentId: "agent-123" },
  };
}

function terminalTab(): WorkspaceTabDescriptor {
  return {
    key: "terminal_abc",
    tabId: "terminal_abc",
    kind: "terminal",
    target: { kind: "terminal", terminalId: "terminal-abc" },
  };
}

function renderAccessory(
  tab: WorkspaceTabDescriptor,
  onRenameTab: (tab: WorkspaceTabDescriptor) => void,
): { base: string; unmount: () => void } {
  const base = `workspace-tab-menu-${tab.tabId}`;
  const menuEntries = buildWorkspaceTabMenuEntries({
    surface: "mobile",
    tab,
    index: 0,
    tabCount: 2,
    menuTestIDBase: base,
    onCopyResumeCommand: vi.fn(),
    onCopyAgentId: vi.fn(),
    onCopyTerminalId: vi.fn(),
    onCopyFilePath: vi.fn(),
    onReloadAgent: vi.fn(),
    onRenameTab,
    onCloseTab: vi.fn(),
    onCloseTabsBefore: vi.fn(),
    onCloseTabsAfter: vi.fn(),
    onCloseOtherTabs: vi.fn(),
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const element: ReactElement = (
    <TooltipProvider>
      <MobileTabTrailingAccessory
        menuTestIDBase={base}
        presentationLabel="My session"
        menuEntries={menuEntries}
      />
    </TooltipProvider>
  );
  act(() => {
    root.render(element);
  });
  return {
    base,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("MobileTabTrailingAccessory", () => {
  let current: { unmount: () => void } | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    current?.unmount();
    current = null;
    vi.unstubAllGlobals();
  });

  it("reaches Rename for an agent session", () => {
    const onRenameTab = vi.fn();
    const rendered = renderAccessory(agentTab(), onRenameTab);
    current = rendered;

    expect(document.querySelector(`[data-testid="${rendered.base}-trigger"]`)).not.toBeNull();
    const trigger = document.querySelector(`[data-testid="${rendered.base}-trigger"]`);
    act(() => {
      fireEvent.keyDown(trigger as HTMLElement, { key: "Enter" });
    });
    const renameButton = document.querySelector(`[data-testid="${rendered.base}-rename"]`);
    expect(renameButton).not.toBeNull();
    fireEvent.click(renameButton as HTMLElement);

    expect(onRenameTab).toHaveBeenCalledTimes(1);
    expect(onRenameTab).toHaveBeenCalledWith(agentTab());
  });

  it("reaches Rename for a terminal session", () => {
    const onRenameTab = vi.fn();
    const rendered = renderAccessory(terminalTab(), onRenameTab);
    current = rendered;

    const trigger = document.querySelector(`[data-testid="${rendered.base}-trigger"]`);
    act(() => {
      fireEvent.keyDown(trigger as HTMLElement, { key: "Enter" });
    });
    const renameButton = document.querySelector(`[data-testid="${rendered.base}-rename"]`);
    expect(renameButton).not.toBeNull();
    fireEvent.click(renameButton as HTMLElement);

    expect(onRenameTab).toHaveBeenCalledWith(terminalTab());
  });
});
