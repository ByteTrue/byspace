/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIEF_FAB_COMPOSER_GAP, CHIEF_FAB_CORNER_INSET } from "./chief-fab-clearance";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { ChiefFab } from "./chief-fab";
import { useChiefFabClearanceStore } from "./chief-fab-clearance";

const noop = () => undefined;

function publishedClearances(clearances: Record<string, number>): void {
  useChiefFabClearanceStore.setState({ clearances });
}

describe("ChiefFab placement", () => {
  let container: HTMLElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    publishedClearances({});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  function renderFab(): HTMLElement {
    act(() => {
      root?.render(<ChiefFab serverId={null} agentId={null} onPress={noop} />);
    });
    const fab = container?.querySelector('[data-testid="chief-fab"]');
    if (!(fab instanceof HTMLElement)) {
      throw new Error("chief fab did not render");
    }
    return fab;
  }

  function bottomOf(element: HTMLElement): string {
    return getComputedStyle(element).bottom;
  }

  it("sits in the window corner while nothing occupies the bottom edge", () => {
    expect(bottomOf(renderFab())).toBe(`${CHIEF_FAB_CORNER_INSET}px`);
  });

  it("rests above a composer that owns the corner, so its send button stays reachable", () => {
    publishedClearances({ "composer:agent-1": 108 });

    expect(bottomOf(renderFab())).toBe(`${108 + CHIEF_FAB_COMPOSER_GAP}px`);
  });

  it("follows the composer when its height changes", () => {
    publishedClearances({ "composer:agent-1": 108 });
    const fab = renderFab();

    act(() => {
      publishedClearances({ "composer:agent-1": 168 });
    });

    expect(bottomOf(fab)).toBe(`${168 + CHIEF_FAB_COMPOSER_GAP}px`);
  });
});
