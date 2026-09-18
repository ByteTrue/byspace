import { afterEach, describe, expect, it, vi } from "vitest";
import { nativePerformanceTrace, traceInstant } from "./native-trace";

interface TraceSink {
  isEnabled: () => boolean;
  beginSection: (name: string, args?: Record<string, string>) => void;
  endSection: () => void;
}

describe("native performance trace", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __byspacePerformanceTrace?: TraceSink })
      .__byspacePerformanceTrace;
  });

  it("forwards tracing to an explicitly installed browser sink", () => {
    const sink: TraceSink = {
      isEnabled: () => true,
      beginSection: vi.fn(),
      endSection: vi.fn(),
    };
    (
      globalThis as typeof globalThis & { __byspacePerformanceTrace?: TraceSink }
    ).__byspacePerformanceTrace = sink;

    expect(nativePerformanceTrace.isEnabled()).toBe(true);
    traceInstant("byspace.test", { size: "4" });

    expect(sink.beginSection).toHaveBeenCalledWith("byspace.test", { size: "4" });
    expect(sink.endSection).toHaveBeenCalledOnce();
  });

  it("contains sink failures and remains a no-op without a sink", () => {
    const sink: TraceSink = {
      isEnabled: () => true,
      beginSection: () => {
        throw new Error("test sink failure");
      },
      endSection: () => {
        throw new Error("test sink failure");
      },
    };
    (
      globalThis as typeof globalThis & { __byspacePerformanceTrace?: TraceSink }
    ).__byspacePerformanceTrace = sink;

    expect(() => traceInstant("byspace.test")).not.toThrow();
    delete (globalThis as typeof globalThis & { __byspacePerformanceTrace?: TraceSink })
      .__byspacePerformanceTrace;
    expect(nativePerformanceTrace.isEnabled()).toBe(false);
  });

  it("contains an isEnabled failure before calling the sink", () => {
    const sink: TraceSink = {
      isEnabled: () => {
        throw new Error("test sink failure");
      },
      beginSection: vi.fn(),
      endSection: vi.fn(),
    };
    (
      globalThis as typeof globalThis & { __byspacePerformanceTrace?: TraceSink }
    ).__byspacePerformanceTrace = sink;

    expect(nativePerformanceTrace.isEnabled()).toBe(false);
    expect(() => traceInstant("byspace.test")).not.toThrow();
    expect(sink.beginSection).not.toHaveBeenCalled();
    expect(sink.endSection).not.toHaveBeenCalled();
  });
});
