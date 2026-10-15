import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChiefFab } from "./chief-fab";
import { CHIEF_FAB_COMPOSER_GAP, useChiefFabClearanceStore } from "./chief-fab-clearance";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

/**
 * The complaint was geometric — the entry sat on the composer's send button —
 * so the assertion is geometric too: after the composer reports itself, the
 * entry's box must not intersect it.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

const noop = () => undefined;

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function fabRect(): DOMRect {
  const fab = document.querySelector('[data-testid="chief-fab"]');
  if (!(fab instanceof HTMLElement)) {
    throw new Error("chief fab did not render");
  }
  return fab.getBoundingClientRect();
}

describe("ChiefFab and the composer's send button", () => {
  beforeEach(() => {
    useChiefFabClearanceStore.setState({ clearances: {} });
  });

  it("leaves the send button reachable once the composer reports itself", () => {
    // A phone-width viewport: the composer fills the bottom of the screen, so
    // its send button lands in the same corner the entry claims.
    const viewportHeight = window.innerHeight;
    const composerTop = viewportHeight - 108;
    mount(<ChiefFab serverId={null} agentId={null} isOpen={false} onPress={noop} />);
    expect(fabRect().bottom).toBeGreaterThan(composerTop);

    act(() => {
      useChiefFabClearanceStore.setState({ clearances: { "composer:agent-1": 108 } });
    });

    const rect = fabRect();
    expect(rect.bottom).toBeLessThanOrEqual(composerTop);
    expect(composerTop - rect.bottom).toBeGreaterThanOrEqual(CHIEF_FAB_COMPOSER_GAP);
  });

  it("returns to the corner when the composer is gone", () => {
    act(() => {
      useChiefFabClearanceStore.setState({ clearances: { "composer:agent-1": 108 } });
    });
    mount(<ChiefFab serverId={null} agentId={null} isOpen={false} onPress={noop} />);
    const raised = fabRect().bottom;

    act(() => {
      useChiefFabClearanceStore.setState({ clearances: {} });
    });

    expect(fabRect().bottom).toBeGreaterThan(raised);
  });
});
