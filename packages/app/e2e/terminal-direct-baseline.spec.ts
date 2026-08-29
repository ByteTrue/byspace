import { copyFile } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { TerminalE2EHarness } from "./helpers/terminal-dsl";

const SAMPLE_TEXT = "abcdefghijklmnopqrstuvwxyzABCD";
const LINE_COUNT = 50_000;
const RUN_MANUAL_TERMINAL_PERF = process.env.BYSPACE_TERMINAL_PERF_E2E === "1";
const terminalPerfDescribe = RUN_MANUAL_TERMINAL_PERF ? test.describe : test.describe.skip;
const workloadSource = path.resolve(process.cwd(), "e2e/fixtures/terminal-direct-workload.mjs");

interface EchoSample {
  index: number;
  char: string;
  keydownAt: number;
  inputAt: number | null;
  markerAt: number | null;
  commitAt: number | null;
}

interface EchoProbe {
  samples: EchoSample[];
  readyMarkerAt: number | null;
  readyCommitAt: number | null;
  dispose: () => void;
}

interface ThroughputProbe {
  startedAt: number;
  markerAt: number | null;
  parsedAt: number | null;
  paintedAt: number | null;
  rafGapsMs: number[];
  longTasksMs: number[];
  dispose: () => void;
}

interface BenchmarkTerminal {
  cols: number;
  rows: number;
  options: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string | number;
    fontWeightBold?: string | number;
    lineHeight?: number;
    minimumContrastRatio?: number;
  };
  focus: () => void;
  input: (data: string, wasUserInput?: boolean) => void;
  onData: (callback: (data: string) => void) => { dispose: () => void };
  onWriteParsed: (callback: () => void) => { dispose: () => void };
  onResize: (callback: (size: { cols: number; rows: number }) => void) => { dispose: () => void };
  parser: {
    registerOscHandler: (
      identifier: number,
      callback: (data: string) => boolean,
    ) => { dispose: () => void };
  };
}

interface ResizeSample {
  elapsedMs: number;
  cols: number;
  rows: number;
}

interface BenchmarkWindow {
  __byspaceTerminal?: BenchmarkTerminal;
  __directTerminalEchoProbe?: EchoProbe;
  __directTerminalThroughputProbe?: ThroughputProbe;
  __directTerminalResizeProbe?: { promise: Promise<ResizeSample> };
}

terminalPerfDescribe("Direct terminal comparison baseline", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-direct-baseline-" });
    await copyFile(
      workloadSource,
      path.join(harness.tempRepo.path, "terminal-direct-workload.mjs"),
    );
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  test("measures idle echo, loaded echo, and bulk rendering", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const created = await harness.createTerminal({ name: "direct-comparison" });

    try {
      await harness.openTerminal(page, { terminalId: created.id });
      await harness.setupPrompt(page);

      const renderer = await page.evaluate(() => {
        const terminal = (window as unknown as BenchmarkWindow).__byspaceTerminal;
        if (!terminal) throw new Error("BySpace terminal is unavailable");
        return {
          canvasCount: document.querySelectorAll('[data-testid="terminal-surface"] canvas').length,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          grid: { cols: terminal.cols, rows: terminal.rows },
          options: {
            fontFamily: terminal.options.fontFamily,
            fontSize: terminal.options.fontSize,
            fontWeight: terminal.options.fontWeight,
            fontWeightBold: terminal.options.fontWeightBold,
            lineHeight: terminal.options.lineHeight,
            minimumContrastRatio: terminal.options.minimumContrastRatio,
          },
          userAgent: navigator.userAgent,
        };
      });
      const idleEcho = await measureEcho(page, "idle");
      const loadedEcho = await measureEcho(page, "load");
      const tuiEcho = await measureEcho(page, "tui");
      const throughput = await measureThroughput(page);
      const resize = await measureResize(page);
      const report = {
        product: "byspace",
        renderer,
        idleEcho,
        loadedEcho,
        tuiEcho,
        throughput,
        resize,
      };
      await attachJson(testInfo, "direct-terminal-baseline", report);
      console.log("[terminal-direct-baseline]", JSON.stringify(report));

      expect(idleEcho.sampleCount).toBe(SAMPLE_TEXT.length);
      expect(loadedEcho.sampleCount).toBe(SAMPLE_TEXT.length);
      expect(tuiEcho.sampleCount).toBe(SAMPLE_TEXT.length);
      expect(throughput.lineCount).toBe(LINE_COUNT);
      expect(throughput.parsedElapsedMs).toBeGreaterThan(0);
      expect(resize.samples).toHaveLength(10);
    } finally {
      await harness.killTerminal(created.id);
    }
  });
});

async function measureEcho(page: Page, mode: "idle" | "load" | "tui") {
  const token = `BYSPACE_${mode.toUpperCase()}_${Date.now()}`;
  await installEchoProbe(page, token);
  await sendTerminalInput(page, `node terminal-direct-workload.mjs ${mode} ${token}\r`);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as BenchmarkWindow).__directTerminalEchoProbe?.readyCommitAt ===
      "number",
    null,
    { timeout: 10_000 },
  );

  for (let index = 0; index < SAMPLE_TEXT.length; index += 1) {
    await page.evaluate(() => {
      (window as unknown as BenchmarkWindow).__byspaceTerminal?.focus();
    });
    await page.keyboard.press(SAMPLE_TEXT.charAt(index));
    await page.waitForFunction(
      (sampleIndex) =>
        typeof (window as unknown as BenchmarkWindow).__directTerminalEchoProbe?.samples[
          sampleIndex
        ]?.commitAt === "number",
      index,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(50);
  }

  const samples = await page.evaluate(() => {
    const probe = (window as unknown as BenchmarkWindow).__directTerminalEchoProbe;
    if (!probe) throw new Error("Direct terminal echo probe disappeared");
    probe.dispose();
    return probe.samples;
  });
  await sendTerminalInput(page, "\u0003");
  await page.waitForTimeout(250);

  const complete = samples.filter(
    (sample): sample is EchoSample & { inputAt: number; markerAt: number; commitAt: number } =>
      sample.inputAt !== null && sample.markerAt !== null && sample.commitAt !== null,
  );
  return {
    mode,
    sampleCount: complete.length,
    keydownToInputMs: summarize(complete.map((sample) => sample.inputAt - sample.keydownAt)),
    inputToMarkerMs: summarize(complete.map((sample) => sample.markerAt - sample.inputAt)),
    markerToCommitMs: summarize(complete.map((sample) => sample.commitAt - sample.markerAt)),
    keydownToCommitMs: summarize(complete.map((sample) => sample.commitAt - sample.keydownAt)),
  };
}

async function installEchoProbe(page: Page, token: string): Promise<void> {
  await page.evaluate((probeToken) => {
    const win = window as unknown as BenchmarkWindow;
    const terminal = win.__byspaceTerminal;
    if (!terminal) throw new Error("BySpace terminal is unavailable");

    const state: EchoProbe = {
      samples: [],
      readyMarkerAt: null,
      readyCommitAt: null,
      dispose: () => {},
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1) return;
      state.samples.push({
        index: state.samples.length + 1,
        char: event.key,
        keydownAt: performance.now(),
        inputAt: null,
        markerAt: null,
        commitAt: null,
      });
    };
    document.addEventListener("keydown", onKeyDown, true);

    const inputDisposable = terminal.onData(() => {
      const pending = state.samples.find((sample) => sample.inputAt === null);
      if (pending) pending.inputAt = performance.now();
    });
    const markerDisposable = terminal.parser.registerOscHandler(777, (data) => {
      const now = performance.now();
      if (data === `${probeToken}:READY`) {
        state.readyMarkerAt = now;
        return true;
      }
      const match = new RegExp(`^${probeToken}:ECHO:(\\d+):(\\d+)$`).exec(data);
      if (match) {
        const sample = state.samples[Number(match[1]) - 1];
        if (sample) sample.markerAt = now;
        return true;
      }
      return false;
    });
    const parsedDisposable = terminal.onWriteParsed(() => {
      const now = performance.now();
      if (state.readyMarkerAt !== null && state.readyCommitAt === null) state.readyCommitAt = now;
      for (const sample of state.samples) {
        if (sample.markerAt !== null && sample.commitAt === null) sample.commitAt = now;
      }
    });
    state.dispose = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      inputDisposable.dispose();
      markerDisposable.dispose();
      parsedDisposable.dispose();
    };
    win.__directTerminalEchoProbe = state;
  }, token);
}

async function measureThroughput(page: Page) {
  const token = `BYSPACE_THROUGHPUT_${Date.now()}`;
  const markerPrefix = `${token}:`;
  const markerSuffix = "DONE";
  await page.evaluate(
    ({ prefix, suffix, lineCount }) => {
      const win = window as unknown as BenchmarkWindow;
      const terminal = win.__byspaceTerminal;
      if (!terminal) throw new Error("BySpace terminal is unavailable");

      const state: ThroughputProbe = {
        startedAt: performance.now(),
        markerAt: null,
        parsedAt: null,
        paintedAt: null,
        rafGapsMs: [],
        longTasksMs: [],
        dispose: () => {},
      };
      let lastFrame = performance.now();
      const sampleFrame = (now: number) => {
        state.rafGapsMs.push(now - lastFrame);
        lastFrame = now;
        if (state.paintedAt === null) requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);

      const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((list) => {
            state.longTasksMs.push(...list.getEntries().map((entry) => entry.duration));
          })
        : null;
      observer?.observe({ entryTypes: ["longtask"] });

      const markerDisposable = terminal.parser.registerOscHandler(777, (data) => {
        if (data !== `${prefix}${suffix}`) return false;
        state.markerAt = performance.now();
        return true;
      });
      const markPainted = () => {
        state.paintedAt = performance.now();
      };
      const scheduleAfterTwoFrames = (callback: FrameRequestCallback) => {
        requestAnimationFrame(requestAnimationFrame.bind(window, callback));
      };
      const parsedDisposable = terminal.onWriteParsed(() => {
        if (state.markerAt === null || state.parsedAt !== null) return;
        state.parsedAt = performance.now();
        scheduleAfterTwoFrames(markPainted);
      });
      state.dispose = () => {
        observer?.disconnect();
        markerDisposable.dispose();
        parsedDisposable.dispose();
      };
      win.__directTerminalThroughputProbe = state;
      terminal.input(
        `seq 1 ${lineCount}; printf '\\033]777;%s%s\\007' '${prefix}' '${suffix}'\r`,
        true,
      );
    },
    { prefix: markerPrefix, suffix: markerSuffix, lineCount: LINE_COUNT },
  );

  await page.waitForFunction(
    () =>
      typeof (window as unknown as BenchmarkWindow).__directTerminalThroughputProbe?.paintedAt ===
      "number",
    null,
    { timeout: 45_000 },
  );
  const result = await page.evaluate(() => {
    const probe = (window as unknown as BenchmarkWindow).__directTerminalThroughputProbe;
    if (!probe || probe.parsedAt === null || probe.paintedAt === null) {
      throw new Error("Direct terminal throughput probe did not finish");
    }
    probe.dispose();
    return {
      parsedElapsedMs: probe.parsedAt - probe.startedAt,
      paintedElapsedMs: probe.paintedAt - probe.startedAt,
      rafGapsMs: probe.rafGapsMs,
      longTasksMs: probe.longTasksMs,
    };
  });
  const estimatedBytes = Array.from(
    { length: LINE_COUNT },
    (_, index) => String(index + 1).length + 1,
  ).reduce((sum, bytes) => sum + bytes, 0);

  return {
    lineCount: LINE_COUNT,
    estimatedBytes,
    parsedElapsedMs: round2(result.parsedElapsedMs),
    paintedElapsedMs: round2(result.paintedElapsedMs),
    throughputMBps: round2(estimatedBytes / (1024 * 1024) / (result.parsedElapsedMs / 1000)),
    rafGapMs: summarize(result.rafGapsMs),
    rafOver50Ms: result.rafGapsMs.filter((gap) => gap >= 50).length,
    longTaskMs: summarize(result.longTasksMs),
  };
}

async function measureResize(page: Page) {
  const widths = [1100, 1280, 1040, 1280, 1120, 1280, 1060, 1280, 1080, 1280];
  const samples: ResizeSample[] = [];

  for (const width of widths) {
    await page.evaluate(() => {
      const win = window as unknown as BenchmarkWindow;
      const terminal = win.__byspaceTerminal;
      if (!terminal) throw new Error("BySpace terminal is unavailable");
      const startedAt = performance.now();
      const resolveAfterTwoFrames = (
        resolve: (sample: ResizeSample) => void,
        size: { cols: number; rows: number },
      ) => {
        const finish = () => resolve({ elapsedMs: performance.now() - startedAt, ...size });
        requestAnimationFrame(requestAnimationFrame.bind(window, finish));
      };
      win.__directTerminalResizeProbe = {
        promise: new Promise<ResizeSample>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error("terminal resize timed out")),
            5000,
          );
          const disposable = terminal.onResize((size) => {
            window.clearTimeout(timeout);
            disposable.dispose();
            resolveAfterTwoFrames(resolve, size);
          });
        }),
      };
    });
    await page.setViewportSize({ width, height: 720 });
    samples.push(
      await page.evaluate(() => {
        const probe = (window as unknown as BenchmarkWindow).__directTerminalResizeProbe;
        if (!probe) throw new Error("BySpace resize probe is unavailable");
        return probe.promise;
      }),
    );
  }

  return {
    samples: samples.map((sample) => ({ ...sample, elapsedMs: round2(sample.elapsedMs) })),
    elapsedMs: summarize(samples.map((sample) => sample.elapsedMs)),
  };
}

async function sendTerminalInput(page: Page, data: string): Promise<void> {
  await page.evaluate((input) => {
    const terminal = (window as unknown as BenchmarkWindow).__byspaceTerminal;
    if (!terminal) throw new Error("BySpace terminal is unavailable");
    terminal.input(input, true);
  }, data);
}

function summarize(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minMs: round2(sorted[0] ?? 0),
    p50Ms: round2(percentile(sorted, 50)),
    p95Ms: round2(percentile(sorted, 95)),
    maxMs: round2(sorted.at(-1) ?? 0),
    avgMs: round2(values.reduce((sum, value) => sum + value, 0) / (values.length || 1)),
  };
}

function percentile(sorted: number[], value: number): number {
  const index = Math.ceil((value / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}
