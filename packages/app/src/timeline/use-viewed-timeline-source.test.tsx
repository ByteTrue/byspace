/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ViewedTimelineUiBridge } from "./viewed-timeline-sync";
import { useViewedTimelineSource } from "./use-viewed-timeline-source";

function createBridge() {
  const replaceVisibleAgentIds = vi.fn();
  return {
    bridge: { replaceVisibleAgentIds } as unknown as ViewedTimelineUiBridge,
    replaceVisibleAgentIds,
  };
}

async function flushCleanup(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

test("replaces a remounted source without transiently clearing it", async () => {
  const { bridge, replaceVisibleAgentIds } = createBridge();
  const first = renderHook(() => useViewedTimelineSource(bridge, "workspace", ["agent-a"]));

  first.unmount();
  const second = renderHook(() => useViewedTimelineSource(bridge, "workspace", ["agent-a"]));
  await flushCleanup();

  expect(replaceVisibleAgentIds.mock.calls).toEqual([
    ["workspace", ["agent-a"]],
    ["workspace", ["agent-a"]],
  ]);

  second.unmount();
  await flushCleanup();
  expect(replaceVisibleAgentIds).toHaveBeenLastCalledWith("workspace", []);
});

test("updates one source without clearing its previous registration first", async () => {
  const { bridge, replaceVisibleAgentIds } = createBridge();
  const view = renderHook(
    ({ agentIds }) => useViewedTimelineSource(bridge, "workspace", agentIds),
    { initialProps: { agentIds: ["agent-a"] } },
  );

  view.rerender({ agentIds: ["agent-b"] });
  await flushCleanup();

  expect(replaceVisibleAgentIds.mock.calls).toEqual([
    ["workspace", ["agent-a"]],
    ["workspace", ["agent-b"]],
  ]);

  view.unmount();
  await flushCleanup();
  expect(replaceVisibleAgentIds).toHaveBeenLastCalledWith("workspace", []);
});
