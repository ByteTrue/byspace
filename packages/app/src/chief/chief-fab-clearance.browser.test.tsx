import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIEF_FAB_COMPOSER_GAP } from "./chief-fab-clearance";
import { usePublishChiefFabClearance } from "./use-publish-chief-fab-clearance";
import { ChiefFab } from "./chief-fab";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

/**
 * The wiring the fix rests on: a composer measures itself in window
 * coordinates and the entry moves above it. Both halve only exist in a real
 * layout engine, so this runs in Chromium.
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

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

const noop = () => undefined;

function ComposerSurface() {
  const { frameRef, reportLayout } = usePublishChiefFabClearance({
    ownerId: "composer:test",
    active: true,
  });
  return (
    <View
      ref={frameRef}
      onLayout={reportLayout}
      testID="composer-surface"
      style={composerSurfaceStyle}
    />
  );
}

const composerSurfaceStyle = {
  position: "absolute" as const,
  right: 0,
  bottom: 0,
  width: "100%" as const,
  height: 108,
  backgroundColor: "black",
};

function rectOf(testID: string): DOMRect {
  const element = document.querySelector(`[data-testid="${testID}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${testID} did not render`);
  }
  return element.getBoundingClientRect();
}

describe("the entry and a composer surface that owns the corner", () => {
  it("keeps the entry out of the composer's box", async () => {
    mount(<ComposerSurface />);
    const composer = rectOf("composer-surface");

    // The composer reports from its own layout; the entry lands on the next frame.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    mount(<ChiefFab serverId={null} agentId={null} onPress={noop} />);

    const fab = rectOf("chief-fab");
    expect(fab.bottom).toBeLessThanOrEqual(composer.top);
    expect(composer.top - fab.bottom).toBeGreaterThanOrEqual(CHIEF_FAB_COMPOSER_GAP);
    expect(fab.right).toBeLessThanOrEqual(composer.right);
  });

  it("leaves the entry in the corner when the surface unmounts", async () => {
    mount(<ComposerSurface />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const raised = mount(<ChiefFab serverId={null} agentId={null} onPress={noop} />);

    const entry = mounted.find((candidate) => candidate.container === raised);
    expect(entry).toBeDefined();
    const raisedBottom = rectOf("chief-fab").bottom;

    act(() => {
      // The composer is the first mount; unmount it and leave the entry alone.
      const composer = mounted[0];
      composer.root.unmount();
      composer.container.remove();
    });

    expect(rectOf("chief-fab").bottom).toBeGreaterThan(raisedBottom);
  });
});
