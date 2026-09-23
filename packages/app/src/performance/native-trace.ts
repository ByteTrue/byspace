import type { DaemonClientTrace } from "@bytetrue/client/internal/daemon-client";

interface BrowserPerformanceTraceSink {
  isEnabled(): boolean;
  beginSection(name: string, args?: Record<string, string>): void;
  endSection(): void;
}

function getBrowserTraceSink(): BrowserPerformanceTraceSink | null {
  try {
    const candidate = (
      globalThis as typeof globalThis & {
        __byspacePerformanceTrace?: BrowserPerformanceTraceSink;
      }
    ).__byspacePerformanceTrace;
    if (
      !candidate ||
      typeof candidate.isEnabled !== "function" ||
      typeof candidate.beginSection !== "function" ||
      typeof candidate.endSection !== "function"
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function safelyCall(callback: () => void): void {
  try {
    callback();
  } catch {
    // Measurement sinks must never affect the application path.
  }
}

function safelyIsEnabled(sink: BrowserPerformanceTraceSink): boolean {
  try {
    return sink.isEnabled() === true;
  } catch {
    return false;
  }
}

export const nativePerformanceTrace: DaemonClientTrace = {
  isEnabled() {
    const browserTrace = getBrowserTraceSink();
    return browserTrace !== null && safelyIsEnabled(browserTrace);
  },
  beginSection(name, args) {
    const browserTrace = getBrowserTraceSink();
    if (browserTrace && safelyIsEnabled(browserTrace)) {
      safelyCall(() => browserTrace.beginSection(name, args));
    }
  },
  endSection() {
    const browserTrace = getBrowserTraceSink();
    if (browserTrace && safelyIsEnabled(browserTrace)) {
      safelyCall(() => browserTrace.endSection());
    }
  },
};

export function traceInstant(name: string, args?: Record<string, string>): void {
  if (!nativePerformanceTrace.isEnabled()) {
    return;
  }
  nativePerformanceTrace.beginSection(name, args);
  nativePerformanceTrace.endSection();
}
