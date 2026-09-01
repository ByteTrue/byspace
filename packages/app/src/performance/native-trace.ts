import type { DaemonClientTrace } from "@getpaseo/client/internal/daemon-client";
import { requireOptionalNativeModule } from "expo-modules-core";
import { isProfileBuild } from "@/constants/build-profile";

interface PaseoNativeTraceModule {
  beginSection(name: string): void;
  endSection(): void;
}

interface BrowserPerformanceTraceSink {
  isEnabled(): boolean;
  beginSection(name: string, args?: Record<string, string>): void;
  endSection(): void;
}

const traceModule = requireOptionalNativeModule<PaseoNativeTraceModule>("PaseoNativeTrace");

function getBrowserTraceSink(): BrowserPerformanceTraceSink | null {
  try {
    const candidate = (
      globalThis as typeof globalThis & {
        __paseoPerformanceTrace?: BrowserPerformanceTraceSink;
      }
    ).__paseoPerformanceTrace;
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
    return (
      (isProfileBuild && traceModule !== null) ||
      (browserTrace !== null && safelyIsEnabled(browserTrace))
    );
  },
  beginSection(name, args) {
    if (isProfileBuild) {
      safelyCall(() => traceModule?.beginSection(formatSectionName(name, args)));
    }
    const browserTrace = getBrowserTraceSink();
    if (browserTrace && safelyIsEnabled(browserTrace)) {
      safelyCall(() => browserTrace.beginSection(name, args));
    }
  },
  endSection() {
    if (isProfileBuild) {
      safelyCall(() => traceModule?.endSection());
    }
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

function formatSectionName(name: string, args?: Record<string, string>): string {
  if (!args) {
    return name;
  }
  const fields = Object.entries(args).map(([key, value]) => `${key}=${value}`);
  return `${name}|${fields.join(";")}`;
}
