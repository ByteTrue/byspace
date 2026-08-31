import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";

export interface TerminalRenderProbeSnapshot {
  setCount: number;
  unsetCount: number;
  writeCount: number;
  resetWrites: number;
  clearScreenWrites: number;
  altEnterWrites: number;
  altExitWrites: number;
  events: TerminalRenderProbeEvent[];
  frames: TerminalFrame[];
}

export interface TerminalRenderProbeEvent {
  at: number;
  type: "set" | "unset" | "reset-write" | "clear-write" | "alt-enter-write" | "alt-exit-write";
  preview?: string;
}

export interface TerminalFrame {
  at: number;
  rowCount: number;
  nonEmptyRows: number;
  firstNonEmptyRow: number | null;
  text: string;
  topText: string;
}

export type TerminalRenderProbeSummary = Omit<TerminalRenderProbeSnapshot, "frames"> & {
  frameCount: number;
};

export interface TerminalKeystrokeStressReport {
  inputTextLength: number;
  keydownCount: number;
  inputFrameCount: number;
  outputFrameCount: number;
  textMessageFrameCount: number;
  textMessagePayloadBytes: number;
  largeTextMessageCount: number;
  largestTextMessageBytes: number;
  agentStreamTextMessageCount: number;
  agentStreamAgentIds: string[];
  agentStreamTextMessagePayloadBytes: number;
  largeAgentStreamTextMessageCount: number;
  largestAgentStreamTextMessageBytes: number;
  appEventCount: number;
  appEventCounts: Record<string, number>;
  runtimeMaxQueueDepth: number;
  xtermWriteCount: number;
  inputFramePayloadBytes: number;
  outputFramePayloadBytes: number;
  keydownToInputFrameMs: LatencyStats | null;
  inputFrameToOutputFrameMs: LatencyStats | null;
  appBinaryReceivedToFrameDecodedMs: LatencyStats | null;
  appFrameDecodedToTerminalEmitMs: LatencyStats | null;
  appTerminalEmitListenerDurationMs: LatencyStats | null;
  appTerminalEmitToStreamControllerOutputMs: LatencyStats | null;
  appStreamControllerDecodeToOnOutputMs: LatencyStats | null;
  appStreamControllerToEmulatorWriteMs: LatencyStats | null;
  appEmulatorWriteToRuntimeEnqueuedMs: LatencyStats | null;
  appRuntimeEnqueuedToOperationStartMs: LatencyStats | null;
  appRuntimeOperationStartToXtermWriteMs: LatencyStats | null;
  appBinaryReceivedToRuntimeEnqueuedMs: LatencyStats | null;
  appBinaryReceivedToRuntimeOperationStartMs: LatencyStats | null;
  outputFrameToXtermWriteMs: LatencyStats | null;
  snapshotFrameCount: number;
  restoreFrameCount: number;
  xtermWriteDurationMs: LatencyStats | null;
  keydownToXtermCommitMs: LatencyStats | null;
  firstKeydownAt: number | null;
  lastXtermCommitAt: number | null;
  outputSequenceCount: number;
  outputSequenceDuplicateCount: number;
  outputSequenceOutOfOrderCount: number;
  outputSequenceMissingCount: number;
  outputSequenceMalformedCount: number;
  outputPayloadMismatchCount: number;
  inputEchoCount: number;
  inputEchoDuplicateCount: number;
  inputEchoOutOfOrderCount: number;
  inputEchoMissingCount: number;
  inputEchoUnexpectedCount: number;
  inputEchoMalformedCount: number;
  outputDoneMarkerCount: number;
  outputDoneDigest: string | null;
  outputDoneDigestValid: boolean | null;
  rafMaxGapMs: number;
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskMaxMs: number;
}

export interface LatencyStats {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
}

export async function installTerminalRenderProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface ProbeTerm {
      write?: (data: string | Uint8Array, callback?: () => void) => void;
      __paseoRenderProbeWriteWrapped?: boolean;
    }
    interface ProbeState {
      term: ProbeTerm | undefined;
      setCount: number;
      unsetCount: number;
      writeCount: number;
      resetWrites: number;
      clearScreenWrites: number;
      altEnterWrites: number;
      altExitWrites: number;
      events: TerminalRenderProbeEvent[];
      frames: TerminalFrame[];
      rafId: number | null;
      sampleUntil: number;
      reset: () => void;
      snapshot: () => TerminalRenderProbeSnapshot;
      startSampling: (durationMs: number) => void;
    }

    const win = window as unknown as Record<string, unknown> & {
      __terminalRenderProbe?: ProbeState;
      __paseoTerminal?: ProbeTerm;
    };
    const existingDescriptor = Object.getOwnPropertyDescriptor(win, "__paseoTerminal");
    const getExisting = () =>
      existingDescriptor?.get ? existingDescriptor.get.call(win) : existingDescriptor?.value;

    const probe: ProbeState = {
      term: getExisting(),
      setCount: 0,
      unsetCount: 0,
      writeCount: 0,
      resetWrites: 0,
      clearScreenWrites: 0,
      altEnterWrites: 0,
      altExitWrites: 0,
      events: [],
      frames: [],
      rafId: null,
      sampleUntil: 0,
      reset() {
        this.setCount = 0;
        this.unsetCount = 0;
        this.writeCount = 0;
        this.resetWrites = 0;
        this.clearScreenWrites = 0;
        this.altEnterWrites = 0;
        this.altExitWrites = 0;
        this.events = [];
        this.frames = [];
      },
      snapshot() {
        return {
          setCount: this.setCount,
          unsetCount: this.unsetCount,
          writeCount: this.writeCount,
          resetWrites: this.resetWrites,
          clearScreenWrites: this.clearScreenWrites,
          altEnterWrites: this.altEnterWrites,
          altExitWrites: this.altExitWrites,
          events: this.events,
          frames: this.frames,
        };
      },
      startSampling(durationMs: number) {
        this.sampleUntil = performance.now() + durationMs;
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
        }
        const sample = () => {
          const rows = Array.from(document.querySelectorAll(".xterm-rows > div")).map(
            (row) => row.textContent ?? "",
          );
          const nonEmptyRows = rows.filter((row) => row.trim().length > 0);
          const firstNonEmptyRow = rows.findIndex((row) => row.trim().length > 0);
          this.frames.push({
            at: performance.now(),
            rowCount: rows.length,
            nonEmptyRows: nonEmptyRows.length,
            firstNonEmptyRow: firstNonEmptyRow === -1 ? null : firstNonEmptyRow,
            text: rows.join("\n"),
            topText: rows.slice(0, 3).join("\n"),
          });
          if (performance.now() < this.sampleUntil) {
            this.rafId = requestAnimationFrame(sample);
          } else {
            this.rafId = null;
          }
        };
        this.rafId = requestAnimationFrame(sample);
      },
    };

    Object.defineProperty(win, "__terminalRenderProbe", {
      configurable: true,
      value: probe,
    });

    Object.defineProperty(win, "__paseoTerminal", {
      configurable: true,
      get() {
        return probe.term;
      },
      set(next: ProbeTerm | undefined) {
        if (next === undefined) {
          probe.unsetCount += 1;
          probe.events.push({ at: performance.now(), type: "unset" });
          probe.term = next;
          return;
        }

        probe.setCount += 1;
        probe.events.push({ at: performance.now(), type: "set" });
        probe.term = next;

        if (next?.write && !next.__paseoRenderProbeWriteWrapped) {
          const originalWrite = next.write.bind(next);
          next.write = (data: string | Uint8Array, callback?: () => void) => {
            const text = typeof data === "string" ? data : new TextDecoder().decode(data);
            probe.writeCount += 1;
            const preview = text
              .replaceAll("\u001b", "\\x1b")
              .replace(/\r/g, "\\r")
              .replace(/\n/g, "\\n")
              .slice(0, 160);
            if (text.includes("\u001bc")) {
              probe.resetWrites += 1;
              probe.events.push({ at: performance.now(), type: "reset-write", preview });
            }
            if (text.includes("\u001b[2J")) {
              probe.clearScreenWrites += 1;
              probe.events.push({ at: performance.now(), type: "clear-write", preview });
            }
            if (text.includes("\u001b[?1049h")) {
              probe.altEnterWrites += 1;
              probe.events.push({ at: performance.now(), type: "alt-enter-write", preview });
            }
            if (text.includes("\u001b[?1049l")) {
              probe.altExitWrites += 1;
              probe.events.push({ at: performance.now(), type: "alt-exit-write", preview });
            }
            return originalWrite(data, callback);
          };
          next.__paseoRenderProbeWriteWrapped = true;
        }
      },
    });
  });
}

interface TerminalRenderProbeWindow {
  __terminalRenderProbe: {
    reset: () => void;
    startSampling: (durationMs: number) => void;
    snapshot: () => TerminalRenderProbeSnapshot;
  };
}

export async function resetTerminalRenderProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as TerminalRenderProbeWindow).__terminalRenderProbe.reset();
  });
}

export async function startTerminalFrameSampling(page: Page, durationMs = 2500): Promise<void> {
  await page.evaluate((ms) => {
    (window as unknown as TerminalRenderProbeWindow).__terminalRenderProbe.startSampling(ms);
  }, durationMs);
}

export async function readTerminalRenderProbe(page: Page): Promise<TerminalRenderProbeSnapshot> {
  return page.evaluate(() =>
    (window as unknown as TerminalRenderProbeWindow).__terminalRenderProbe.snapshot(),
  );
}

export async function terminalVisibleText(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".xterm-rows > div"))
      .map((row) => row.textContent ?? "")
      .join("\n"),
  );
}

export function summarizeTerminalRenderProbe(
  probe: TerminalRenderProbeSnapshot,
): TerminalRenderProbeSummary {
  return {
    setCount: probe.setCount,
    unsetCount: probe.unsetCount,
    writeCount: probe.writeCount,
    resetWrites: probe.resetWrites,
    clearScreenWrites: probe.clearScreenWrites,
    altEnterWrites: probe.altEnterWrites,
    altExitWrites: probe.altExitWrites,
    events: probe.events,
    frameCount: probe.frames.length,
  };
}

export async function installTerminalKeystrokeStressProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface XtermWriteEvent {
      at: number;
      committedAt: number | null;
      text: string;
      bytes: number;
    }
    interface AppProbeEvent {
      type: string;
      at: number;
      bytes?: number;
      durationMs?: number;
      opcode?: number;
      queueDepth?: number;
      receivedAtMs?: number;
    }
    interface TraceEvent {
      name: string;
      at: number;
      durationMs: number;
      args: Record<string, string>;
    }
    interface BrowserPerformanceTraceSink {
      isEnabled: () => boolean;
      beginSection: (name: string, args?: Record<string, string>) => void;
      endSection: () => void;
    }
    interface StressProbeState {
      keydowns: Array<{ at: number; key: string }>;
      xtermWrites: XtermWriteEvent[];
      appEvents: AppProbeEvent[];
      traceEvents: TraceEvent[];
      rafMaxGapMs: number;
      longTaskSupported: boolean;
      longTaskCount: number;
      longTaskMaxMs: number;
      reset: () => void;
      report: (
        inputText: string,
        options?: {
          expectedSequenceCount?: number;
          expectedOutputPayload?: string;
          expectedInputEchoes?: Array<{ seq: number; nonce: string }>;
          expectedOutputDigest?: string;
          terminalText?: string;
        },
      ) => TerminalKeystrokeStressReport;
    }

    const INPUT_OPCODE = 0x02;
    const OUTPUT_OPCODE = 0x01;

    function summarize(values: number[]): LatencyStats | null {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = (p: number) => {
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
      };
      const total = values.reduce((sum, value) => sum + value, 0);
      const round2 = (value: number) => Math.round(value * 100) / 100;
      return {
        count: values.length,
        minMs: round2(sorted[0] ?? 0),
        p50Ms: round2(percentile(50)),
        p95Ms: round2(percentile(95)),
        maxMs: round2(sorted[sorted.length - 1] ?? 0),
        avgMs: round2(total / values.length),
      };
    }

    function firstAtOrAfter<T extends { at: number }>(events: T[], at: number): T | null {
      return events.find((event) => event.at >= at) ?? null;
    }

    function firstCommitAtOrAfter(events: XtermWriteEvent[], at: number): XtermWriteEvent | null {
      return (
        events.find((event) => typeof event.committedAt === "number" && event.committedAt >= at) ??
        null
      );
    }

    function countByType(events: AppProbeEvent[]): Record<string, number> {
      const counts: Record<string, number> = {};
      for (const event of events) {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
      }
      return counts;
    }

    const traceAppEventTypes: Record<string, string> = {
      "paseo.terminal.client.input-frame": "daemon-client-input-frame",
      "paseo.terminal.client.output-frame": "daemon-client-output-frame",
      "paseo.terminal.client.frame-decoded": "daemon-client-frame-decoded",
      "paseo.terminal.client.terminal-emit": "daemon-client-terminal-emit",
      "paseo.terminal.stream-controller.output": "stream-controller-output",
      "paseo.terminal.stream-controller.on-output": "stream-controller-on-output",
      "paseo.terminal.stream-controller-to-emulator-write": "terminal-emulator-write-output",
      "paseo.terminal.runtime-write-enqueued": "runtime-write-enqueued",
      "paseo.terminal.runtime-operation-start": "runtime-operation-start",
      "paseo.terminal.runtime-xterm-write": "runtime-xterm-write",
    };

    function appEventsOf(type: string, events: AppProbeEvent[]): AppProbeEvent[] {
      return events.filter((event) => event.type === type);
    }

    function latencyByIndex(from: AppProbeEvent[], to: AppProbeEvent[]): number[] {
      const count = Math.min(from.length, to.length);
      const values: number[] = [];
      for (let index = 0; index < count; index += 1) {
        values.push(to[index].at - from[index].at);
      }
      return values;
    }

    function latencyFromReceivedAt(from: AppProbeEvent[], to: AppProbeEvent[]): number[] {
      const count = Math.min(from.length, to.length);
      const values: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const receivedAtMs = from[index].receivedAtMs;
        if (typeof receivedAtMs === "number") {
          values.push(to[index].at - receivedAtMs);
        }
      }
      return values;
    }

    function parseOutputLines(text: string): {
      parsed: Array<{ sequence: number; payload: string }>;
      malformedCount: number;
    } {
      const lines = [...text.matchAll(/(?:^|[\r\n])(OUT[^\r\n]*)(?=[\r\n]|$)/gu)].map(
        (match) => match[1] ?? "",
      );
      const parsed = lines.flatMap((line) => {
        const match = /^OUT:(\d+):(.*)$/u.exec(line);
        return match ? [{ sequence: Number(match[1]), payload: match[2] ?? "" }] : [];
      });
      return { parsed, malformedCount: lines.length - parsed.length };
    }

    function parseInputEchoes(text: string): {
      parsed: Array<{ seq: number; nonce: string }>;
      malformedCount: number;
    } {
      const lines = [...text.matchAll(/(?:^|[\r\n])(ECHO[^\r\n]*)(?=[\r\n]|$)/gu)].map(
        (match) => match[1] ?? "",
      );
      const parsed = lines.flatMap((line) => {
        const match = /^ECHO:(\d+):([A-Za-z0-9_-]+)$/u.exec(line);
        return match ? [{ seq: Number(match[1]), nonce: match[2] ?? "" }] : [];
      });
      return { parsed, malformedCount: lines.length - parsed.length };
    }

    function measureSequenceIntegrity(
      text: string,
      expectedCount: number | undefined,
      expectedPayload: string | undefined,
    ): Pick<
      TerminalKeystrokeStressReport,
      | "outputSequenceCount"
      | "outputSequenceDuplicateCount"
      | "outputSequenceOutOfOrderCount"
      | "outputSequenceMissingCount"
      | "outputSequenceMalformedCount"
      | "outputPayloadMismatchCount"
    > {
      const output = parseOutputLines(text);
      const values = output.parsed.map((line) => line.sequence);
      const uniqueValues = new Set(values);
      let outOfOrderCount = 0;
      for (let index = 1; index < values.length; index += 1) {
        if (values[index] <= values[index - 1]) {
          outOfOrderCount += 1;
        }
      }
      return {
        outputSequenceCount: values.length,
        outputSequenceDuplicateCount: values.length - uniqueValues.size,
        outputSequenceOutOfOrderCount: outOfOrderCount,
        outputSequenceMissingCount:
          expectedCount === undefined
            ? 0
            : Array.from({ length: expectedCount }, (_, index) => index).filter(
                (index) => !uniqueValues.has(index),
              ).length,
        outputSequenceMalformedCount: output.malformedCount,
        outputPayloadMismatchCount:
          expectedPayload === undefined
            ? 0
            : output.parsed.filter((line) => line.payload !== expectedPayload).length,
      };
    }

    function measureInputEchoIntegrity(
      text: string,
      expectedEchoes: Array<{ seq: number; nonce: string }> | undefined,
    ): Pick<
      TerminalKeystrokeStressReport,
      | "inputEchoCount"
      | "inputEchoDuplicateCount"
      | "inputEchoOutOfOrderCount"
      | "inputEchoMissingCount"
      | "inputEchoUnexpectedCount"
      | "inputEchoMalformedCount"
    > {
      const input = parseInputEchoes(text);
      const echoes = input.parsed;
      const keys = echoes.map((echo) => `${echo.seq}:${echo.nonce}`);
      const uniqueKeys = new Set(keys);
      let outOfOrderCount = 0;
      for (let index = 1; index < echoes.length; index += 1) {
        if (echoes[index].seq <= echoes[index - 1].seq) {
          outOfOrderCount += 1;
        }
      }
      const expectedKeys = new Set(
        expectedEchoes?.map((echo) => `${echo.seq}:${echo.nonce}`) ?? [],
      );
      return {
        inputEchoCount: echoes.length,
        inputEchoDuplicateCount: keys.length - uniqueKeys.size,
        inputEchoOutOfOrderCount: outOfOrderCount,
        inputEchoMissingCount:
          expectedEchoes?.filter((echo) => !uniqueKeys.has(`${echo.seq}:${echo.nonce}`)).length ??
          0,
        inputEchoUnexpectedCount: expectedEchoes
          ? keys.filter((key) => !expectedKeys.has(key)).length
          : 0,
        inputEchoMalformedCount: input.malformedCount,
      };
    }

    function measureDoneIntegrity(
      text: string,
      expectedSequenceCount: number | undefined,
      expectedOutputDigest: string | undefined,
    ): Pick<
      TerminalKeystrokeStressReport,
      "outputDoneMarkerCount" | "outputDoneDigest" | "outputDoneDigestValid"
    > {
      const markers = [...text.matchAll(/WORKLOAD_DONE:(\d+):([a-f0-9]{64})/gu)];
      const lastMarker = markers.at(-1);
      const digest = lastMarker?.[2] ?? null;
      return {
        outputDoneMarkerCount: markers.length,
        outputDoneDigest: digest,
        outputDoneDigestValid:
          expectedOutputDigest === undefined
            ? null
            : markers.length === 1 &&
              Number(lastMarker?.[1]) === expectedSequenceCount &&
              digest === expectedOutputDigest,
      };
    }

    const traceStack: Array<{ name: string; at: number; args: Record<string, string> }> = [];
    let lastRafAt = performance.now();
    let longTaskObserver: PerformanceObserver | null = null;
    const probe: StressProbeState = {
      keydowns: [],
      xtermWrites: [],
      appEvents: [],
      traceEvents: [],
      rafMaxGapMs: 0,
      longTaskSupported: false,
      longTaskCount: 0,
      longTaskMaxMs: 0,
      reset() {
        this.keydowns = [];
        this.xtermWrites = [];
        this.appEvents = [];
        this.traceEvents = [];
        traceStack.length = 0;
        this.rafMaxGapMs = 0;
        lastRafAt = performance.now();
        longTaskObserver?.disconnect();
        longTaskObserver = null;
        this.longTaskSupported = false;
        this.longTaskCount = 0;
        this.longTaskMaxMs = 0;
        startLongTaskObserver();
      },
      report(inputText: string, options) {
        const inputFrames = appEventsOf("daemon-client-input-frame", this.appEvents).filter(
          (event) => event.opcode === INPUT_OPCODE,
        );
        const outputFrames = appEventsOf("daemon-client-output-frame", this.appEvents);
        const traceAgentStreams = this.traceEvents.filter(
          (event) => event.name === "paseo.agent.stream.inbound",
        );
        const traceAgentStreamBytes = traceAgentStreams.map(
          (event) => Number(event.args.size) || 0,
        );
        const frameDecoded = appEventsOf("daemon-client-frame-decoded", this.appEvents);
        const decodedOutputFrames = frameDecoded.filter((event) => event.opcode === OUTPUT_OPCODE);
        const terminalEmit = appEventsOf("daemon-client-terminal-emit", this.appEvents);
        const streamControllerOutput = appEventsOf("stream-controller-output", this.appEvents);
        const streamControllerOnOutput = appEventsOf("stream-controller-on-output", this.appEvents);
        const emulatorWriteOutput = appEventsOf("terminal-emulator-write-output", this.appEvents);
        const runtimeWriteEnqueued = appEventsOf("runtime-write-enqueued", this.appEvents);
        const runtimeOperationStart = appEventsOf("runtime-operation-start", this.appEvents);
        const runtimeXtermWrite = appEventsOf("runtime-xterm-write", this.appEvents);
        const terminalText =
          options?.terminalText ?? this.xtermWrites.map((write) => write.text).join("");
        const sequenceIntegrity = measureSequenceIntegrity(
          terminalText,
          options?.expectedSequenceCount,
          options?.expectedOutputPayload,
        );
        const inputEchoIntegrity = measureInputEchoIntegrity(
          terminalText,
          options?.expectedInputEchoes,
        );
        const doneIntegrity = measureDoneIntegrity(
          terminalText,
          options?.expectedSequenceCount,
          options?.expectedOutputDigest,
        );
        const outputDoneDigestValid =
          doneIntegrity.outputDoneDigestValid === null
            ? null
            : doneIntegrity.outputDoneDigestValid &&
              sequenceIntegrity.outputSequenceDuplicateCount === 0 &&
              sequenceIntegrity.outputSequenceOutOfOrderCount === 0 &&
              sequenceIntegrity.outputSequenceMissingCount === 0 &&
              sequenceIntegrity.outputSequenceMalformedCount === 0 &&
              sequenceIntegrity.outputPayloadMismatchCount === 0;
        const keydownToInputFrame = this.keydowns
          .map((keydown) => {
            const frame = firstAtOrAfter(inputFrames, keydown.at);
            return frame ? frame.at - keydown.at : null;
          })
          .filter((value): value is number => value !== null);
        const inputFrameToOutputFrame = inputFrames
          .map((input) => {
            const output = firstAtOrAfter(outputFrames, input.at);
            return output ? output.at - input.at : null;
          })
          .filter((value): value is number => value !== null);
        const outputFrameToXtermWrite = outputFrames
          .filter((output) => output.opcode === OUTPUT_OPCODE)
          .map((output) => {
            const write = firstAtOrAfter(this.xtermWrites, output.at);
            return write ? write.at - output.at : null;
          })
          .filter((value): value is number => value !== null);
        const xtermWriteDurations = this.xtermWrites
          .map((write) => (write.committedAt === null ? null : write.committedAt - write.at))
          .filter((value): value is number => value !== null);
        const keydownToXtermCommit = this.keydowns
          .map((keydown) => {
            const write = firstCommitAtOrAfter(this.xtermWrites, keydown.at);
            return write?.committedAt ? write.committedAt - keydown.at : null;
          })
          .filter((value): value is number => value !== null);
        const snapshotFrameCount = outputFrames.filter((event) => event.opcode === 0x04).length;
        const restoreFrameCount = outputFrames.filter((event) => event.opcode === 0x05).length;

        return {
          inputTextLength: inputText.length,
          keydownCount: this.keydowns.length,
          inputFrameCount: inputFrames.length,
          outputFrameCount: outputFrames.filter((event) => event.opcode === OUTPUT_OPCODE).length,
          textMessageFrameCount: traceAgentStreams.length,
          textMessagePayloadBytes: traceAgentStreamBytes.reduce((sum, bytes) => sum + bytes, 0),
          largeTextMessageCount: traceAgentStreamBytes.filter((bytes) => bytes >= 50_000).length,
          largestTextMessageBytes: Math.max(0, ...traceAgentStreamBytes),
          agentStreamTextMessageCount: traceAgentStreams.length,
          agentStreamAgentIds: [
            ...new Set(
              traceAgentStreams
                .map((event) => event.args.agentId)
                .filter((agentId): agentId is string => typeof agentId === "string"),
            ),
          ],
          agentStreamTextMessagePayloadBytes: traceAgentStreamBytes.reduce(
            (sum, bytes) => sum + bytes,
            0,
          ),
          largeAgentStreamTextMessageCount: traceAgentStreamBytes.filter((bytes) => bytes >= 50_000)
            .length,
          largestAgentStreamTextMessageBytes: Math.max(0, ...traceAgentStreamBytes),
          appEventCount: this.appEvents.length,
          appEventCounts: countByType(this.appEvents),
          runtimeMaxQueueDepth: Math.max(
            0,
            ...this.appEvents
              .map((event) => event.queueDepth)
              .filter((value): value is number => typeof value === "number"),
          ),
          xtermWriteCount: this.xtermWrites.length,
          inputFramePayloadBytes: inputFrames.reduce((sum, event) => sum + (event.bytes ?? 0), 0),
          outputFramePayloadBytes: outputFrames
            .filter((event) => event.opcode === OUTPUT_OPCODE)
            .reduce((sum, event) => sum + (event.bytes ?? 0), 0),
          snapshotFrameCount,
          restoreFrameCount,
          keydownToInputFrameMs: summarize(keydownToInputFrame),
          inputFrameToOutputFrameMs: summarize(inputFrameToOutputFrame),
          appBinaryReceivedToFrameDecodedMs: summarize(
            latencyFromReceivedAt(decodedOutputFrames, decodedOutputFrames),
          ),
          appFrameDecodedToTerminalEmitMs: summarize(latencyByIndex(frameDecoded, terminalEmit)),
          appTerminalEmitListenerDurationMs: summarize(
            terminalEmit
              .map((event) => event.durationMs)
              .filter((duration): duration is number => typeof duration === "number"),
          ),
          appTerminalEmitToStreamControllerOutputMs: summarize(
            latencyByIndex(terminalEmit, streamControllerOutput),
          ),
          appStreamControllerDecodeToOnOutputMs: summarize(
            latencyByIndex(streamControllerOutput, streamControllerOnOutput),
          ),
          appStreamControllerToEmulatorWriteMs: summarize(
            latencyByIndex(streamControllerOutput, emulatorWriteOutput),
          ),
          appEmulatorWriteToRuntimeEnqueuedMs: summarize(
            latencyByIndex(emulatorWriteOutput, runtimeWriteEnqueued),
          ),
          appRuntimeEnqueuedToOperationStartMs: summarize(
            latencyByIndex(runtimeWriteEnqueued, runtimeOperationStart),
          ),
          appRuntimeOperationStartToXtermWriteMs: summarize(
            latencyByIndex(runtimeOperationStart, runtimeXtermWrite),
          ),
          appBinaryReceivedToRuntimeEnqueuedMs: summarize(
            latencyFromReceivedAt(decodedOutputFrames, runtimeWriteEnqueued),
          ),
          appBinaryReceivedToRuntimeOperationStartMs: summarize(
            latencyFromReceivedAt(decodedOutputFrames, runtimeOperationStart),
          ),
          outputFrameToXtermWriteMs: summarize(outputFrameToXtermWrite),
          xtermWriteDurationMs: summarize(xtermWriteDurations),
          keydownToXtermCommitMs: summarize(keydownToXtermCommit),
          firstKeydownAt: this.keydowns[0]?.at ?? null,
          lastXtermCommitAt:
            this.xtermWrites
              .map((write) => write.committedAt)
              .findLast((at): at is number => typeof at === "number") ?? null,
          ...sequenceIntegrity,
          ...inputEchoIntegrity,
          ...doneIntegrity,
          outputDoneDigestValid,
          rafMaxGapMs: this.rafMaxGapMs,
          longTaskSupported: this.longTaskSupported,
          longTaskCount: this.longTaskCount,
          longTaskMaxMs: this.longTaskMaxMs,
        };
      },
    };

    const traceSink: BrowserPerformanceTraceSink = {
      isEnabled: () => true,
      beginSection(name, args = {}) {
        traceStack.push({ name, at: performance.now(), args });
      },
      endSection() {
        const started = traceStack.pop();
        if (!started) {
          return;
        }
        const event: TraceEvent = {
          name: started.name,
          at: started.at,
          durationMs: performance.now() - started.at,
          args: started.args,
        };
        probe.traceEvents.push(event);
        const type = traceAppEventTypes[event.name];
        if (type) {
          const bytes = Number(event.args.size);
          const opcode = Number(event.args.opcode);
          const queueDepth = Number(event.args.queueDepth);
          const receivedAtMs = Number(event.args.receivedAtMs);
          probe.appEvents.push({
            type,
            at: event.at,
            ...(Number.isFinite(bytes) ? { bytes } : {}),
            ...(Number.isInteger(opcode) ? { opcode } : {}),
            ...(Number.isInteger(queueDepth) ? { queueDepth } : {}),
            ...(Number.isFinite(receivedAtMs) ? { receivedAtMs } : {}),
            durationMs: event.durationMs,
          });
        }
      },
    };
    Object.defineProperty(window, "__paseoPerformanceTrace", {
      configurable: true,
      value: traceSink,
    });

    const observeRaf = () => {
      const now = performance.now();
      probe.rafMaxGapMs = Math.max(probe.rafMaxGapMs, now - lastRafAt);
      lastRafAt = now;
      requestAnimationFrame(observeRaf);
    };
    requestAnimationFrame(observeRaf);
    function startLongTaskObserver(): void {
      if (typeof PerformanceObserver === "undefined") {
        return;
      }
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            probe.longTaskCount += 1;
            probe.longTaskMaxMs = Math.max(probe.longTaskMaxMs, entry.duration);
          }
        });
        longTaskObserver.observe({ entryTypes: ["longtask"] });
        probe.longTaskSupported = true;
      } catch {
        longTaskObserver = null;
        // Long-task entries are optional on browsers without the entry type.
      }
    }
    startLongTaskObserver();

    Object.defineProperty(window, "__terminalKeystrokeStressProbe", {
      configurable: true,
      value: probe,
    });

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key.length === 1) {
          probe.keydowns.push({ at: performance.now(), key: event.key });
        }
      },
      true,
    );

    const existingDescriptor = Object.getOwnPropertyDescriptor(window, "__paseoTerminal");
    const getExisting = () =>
      existingDescriptor?.get ? existingDescriptor.get.call(window) : existingDescriptor?.value;

    let terminal = getExisting();
    Object.defineProperty(window, "__paseoTerminal", {
      configurable: true,
      get() {
        return terminal;
      },
      set(next: {
        write?: (data: string | Uint8Array, callback?: () => void) => void;
        __paseoKeystrokeProbeWriteWrapped?: boolean;
      }) {
        terminal = next;
        if (next?.write && !next.__paseoKeystrokeProbeWriteWrapped) {
          const originalWrite = next.write.bind(next);
          next.write = (data: string | Uint8Array, callback?: () => void) => {
            const text = typeof data === "string" ? data : new TextDecoder().decode(data);
            const event: XtermWriteEvent = {
              at: performance.now(),
              committedAt: null,
              text,
              bytes: text.length,
            };
            probe.xtermWrites.push(event);
            return originalWrite(data, () => {
              event.committedAt = performance.now();
              callback?.();
            });
          };
          next.__paseoKeystrokeProbeWriteWrapped = true;
        }
      },
    });
  });
}

interface TerminalKeystrokeStressProbeWindow {
  __terminalKeystrokeStressProbe: {
    reset: () => void;
    report: (
      text: string,
      options?: {
        expectedSequenceCount?: number;
        expectedOutputPayload?: string;
        expectedInputEchoes?: Array<{ seq: number; nonce: string }>;
        expectedOutputDigest?: string;
        terminalText?: string;
      },
    ) => TerminalKeystrokeStressReport;
  };
}

export async function resetTerminalKeystrokeStressProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as TerminalKeystrokeStressProbeWindow
    ).__terminalKeystrokeStressProbe.reset();
  });
}

export async function readTerminalKeystrokeStressReport(
  page: Page,
  inputText: string,
  options?: {
    expectedSequenceCount?: number;
    expectedOutputPayload?: string;
    expectedInputEchoes?: Array<{ seq: number; nonce: string }>;
    expectedOutputDigest?: string;
    terminalText?: string;
  },
): Promise<TerminalKeystrokeStressReport> {
  return page.evaluate(
    ({ text, reportOptions }) =>
      (
        window as unknown as TerminalKeystrokeStressProbeWindow
      ).__terminalKeystrokeStressProbe.report(text, reportOptions),
    { text: inputText, reportOptions: options },
  );
}

function readGitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function readTerminalPerformanceEnvironment(
  page: Page,
  transport: "direct" | "relay",
): Promise<Record<string, unknown>> {
  const browser = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  }));
  return {
    os: process.platform,
    arch: process.arch,
    commit: readGitHead(),
    browser,
    transport,
    transportTopology:
      transport === "relay"
        ? "local Relay/E2EE (loopback Wrangler endpoint)"
        : "local Direct daemon WebSocket (loopback)",
  };
}
