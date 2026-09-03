/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const scheduledUiJobs = vi.hoisted(() => {
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  return {
    jobs: [] as unknown[][],
  };
});

vi.mock("react-native-worklets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native-worklets")>();
  return {
    ...actual,
    scheduleOnUI: (worklet: unknown, ...args: unknown[]) => {
      scheduledUiJobs.jobs.push([worklet, ...args]);
    },
  };
});

vi.mock("@/components/retained-panel", () => ({
  useRetainedPanelActive: () => true,
}));

import { SyncedLoader } from "./synced-loader";

describe("SyncedLoader", () => {
  it("schedules UI animation listeners unconditionally even when reduced-motion is active", () => {
    scheduledUiJobs.jobs = [];

    render(<SyncedLoader size={14} color="#f59e0b" />);

    expect(scheduledUiJobs.jobs.length).toBeGreaterThan(0);
    const [workletFn, step, registered, listenerId] = scheduledUiJobs.jobs[0] ?? [];
    expect(typeof workletFn).toBe("function");
    expect(step).toBeDefined();
    expect(registered).toBeDefined();
    expect(typeof listenerId).toBe("number");
  });
});
