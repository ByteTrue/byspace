import { createHash } from "node:crypto";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { TerminalE2EHarness, type TerminalInstance } from "../support/helpers/terminal-dsl";
import {
  installTerminalKeystrokeStressProbe,
  readTerminalKeystrokeStressReport,
  resetTerminalKeystrokeStressProbe,
  readTerminalPerformanceEnvironment,
  type LatencyStats,
} from "../support/helpers/terminal-probes";
import { waitForTerminalContent, waitForTerminalTailText } from "../support/helpers/terminal-perf";

const INPUT_TEXT = buildStressText(600);
const STRESS_TIMEOUT_MS = 15_000;
const RUN_MANUAL_TERMINAL_PERF = process.env.PASEO_TERMINAL_PERF_E2E === "1";
const TERMINAL_TRANSPORT = process.env.PASEO_TERMINAL_TRANSPORT === "relay" ? "relay" : "direct";
const WORKLOAD_FIXTURE = path.resolve(__dirname, "../fixtures/terminal-workload.mjs");
const WORKLOAD_OUTPUT_COUNT = 1000;
const WORKLOAD_OUTPUT_PAYLOAD = "x";
const WORKLOAD_INPUT_COUNT = 24;
const WORKLOAD_AGENT_STREAM_UPDATE_COUNT = 1000;
const WORKLOAD_BIG_DIFF_BYTES = 256_000;
const terminalPerfDescribe = RUN_MANUAL_TERMINAL_PERF ? test.describe : test.describe.skip;

interface DaemonEchoReport {
  inputTextLength: number;
  inputFrameCount: number;
  outputEventCount: number;
  echoedBytes: number;
  sendToOutputMs: LatencyStats;
  firstSendAt: number;
  lastOutputAt: number;
}

terminalPerfDescribe("Terminal keystroke stress", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-key-stress-" });
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  test("logs daemon-only and app keystroke echo latency under burst input", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    const daemonTerminal = await harness.createTerminal({
      name: "daemon-keystroke-baseline",
      command: process.execPath,
      args: [WORKLOAD_FIXTURE, "--mode", "echo"],
    });
    try {
      const daemonReport = await measureDaemonBurstEcho(harness, daemonTerminal, INPUT_TEXT);
      await attachJson(testInfo, "daemon-keystroke-baseline", daemonReport);
      console.log("[terminal-stress-daemon]", JSON.stringify(daemonReport));

      expect(daemonReport.echoedBytes).toBeGreaterThanOrEqual(INPUT_TEXT.length);
    } finally {
      await harness.killTerminal(daemonTerminal.id);
    }

    await installTerminalKeystrokeStressProbe(page);
    await attachJson(
      testInfo,
      "environment",
      await readTerminalPerformanceEnvironment(page, TERMINAL_TRANSPORT),
    );
    const appBaselineReport = await measureAppBurstEcho({
      page,
      harness,
      terminalName: "app-keystroke-stress",
    });
    await attachJson(testInfo, "app-keystroke-stress", appBaselineReport);
    console.log("[terminal-stress-app]", JSON.stringify(appBaselineReport));

    expect(appBaselineReport.keydownCount).toBeGreaterThanOrEqual(INPUT_TEXT.length);
    expect(appBaselineReport.inputFramePayloadBytes).toBeGreaterThanOrEqual(INPUT_TEXT.length);
    expect(appBaselineReport.outputFramePayloadBytes).toBeGreaterThanOrEqual(INPUT_TEXT.length);
    expect(appBaselineReport.keydownToXtermCommitMs?.count ?? 0).toBeGreaterThan(0);
    expectFrameBudgets(appBaselineReport);

    const appObserveNodeBurstReport = await measureAppObservingNodeBurstEcho({
      page,
      harness,
      terminalName: "app-observe-node-burst",
    });
    await attachJson(testInfo, "app-observe-node-burst", appObserveNodeBurstReport);
    console.log(
      "[terminal-stress-app-observe-node-burst]",
      JSON.stringify(appObserveNodeBurstReport),
    );

    expect(appObserveNodeBurstReport.outputFramePayloadBytes).toBeGreaterThanOrEqual(
      INPUT_TEXT.length,
    );
    expect(appObserveNodeBurstReport.xtermWriteCount).toBeGreaterThan(0);
    expectFrameBudgets(appObserveNodeBurstReport);

    const workloadReport = await measureNodeWorkload({ page, harness });
    await attachJson(testInfo, "node-workload-combined", workloadReport);
    console.log("[terminal-stress-node-workload-combined]", JSON.stringify(workloadReport));
    expect(workloadReport.outputSequenceCount).toBe(WORKLOAD_OUTPUT_COUNT);
    expect(workloadReport.outputSequenceDuplicateCount).toBe(0);
    expect(workloadReport.outputSequenceOutOfOrderCount).toBe(0);
    expect(workloadReport.outputSequenceMissingCount).toBe(0);
    expect(workloadReport.outputSequenceMalformedCount).toBe(0);
    expect(workloadReport.outputPayloadMismatchCount).toBe(0);
    expect(workloadReport.inputEchoCount).toBe(WORKLOAD_INPUT_COUNT);
    expect(workloadReport.inputEchoDuplicateCount).toBe(0);
    expect(workloadReport.inputEchoOutOfOrderCount).toBe(0);
    expect(workloadReport.inputEchoMissingCount).toBe(0);
    expect(workloadReport.inputEchoUnexpectedCount).toBe(0);
    expect(workloadReport.inputEchoMalformedCount).toBe(0);
    expect(workloadReport.outputDoneMarkerCount).toBe(1);
    expect(workloadReport.outputDoneDigestValid).toBe(true);
    expect(workloadReport.snapshotFrameCount).toBe(0);
    expect(workloadReport.restoreFrameCount).toBe(0);
    expect(workloadReport.xtermWriteCount).toBeGreaterThan(0);
    expect(workloadReport.agentStreamTextMessageCount).toBeGreaterThanOrEqual(
      WORKLOAD_AGENT_STREAM_UPDATE_COUNT,
    );
    expect(workloadReport.agentStreamAgentIds.length).toBeGreaterThanOrEqual(1);
    expect(workloadReport.largeAgentStreamTextMessageCount).toBeGreaterThanOrEqual(1);
    expect(workloadReport.largestAgentStreamTextMessageBytes).toBeGreaterThanOrEqual(
      WORKLOAD_BIG_DIFF_BYTES,
    );
    expectFrameBudgets(workloadReport);
  });
});

async function measureAppBurstEcho(input: {
  page: Page;
  harness: TerminalE2EHarness;
  terminalName: string;
}) {
  const appTerminal = await input.harness.createTerminal({
    name: input.terminalName,
    command: process.execPath,
    args: [WORKLOAD_FIXTURE, "--mode", "echo"],
  });
  try {
    await input.harness.openTerminal(input.page, { terminalId: appTerminal.id });
    await waitForTerminalContent(
      input.page,
      (content) => content.includes("WORKLOAD_READY"),
      STRESS_TIMEOUT_MS,
    );

    const terminal = input.harness.terminalSurface(input.page);
    await resetTerminalKeystrokeStressProbe(input.page);

    await terminal.pressSequentially(INPUT_TEXT, { delay: 0 });
    await waitForAppStressEcho(input.page, INPUT_TEXT);
    await waitForAppProbePayload(input.page, INPUT_TEXT.length);

    return readTerminalKeystrokeStressReport(input.page, INPUT_TEXT);
  } finally {
    await input.harness.killTerminal(appTerminal.id);
  }
}

async function measureAppObservingNodeBurstEcho(input: {
  page: Page;
  harness: TerminalE2EHarness;
  terminalName: string;
}) {
  const appTerminal = await input.harness.createTerminal({
    name: input.terminalName,
    command: process.execPath,
    args: [WORKLOAD_FIXTURE, "--mode", "echo"],
  });
  try {
    await input.harness.openTerminal(input.page, { terminalId: appTerminal.id });
    await waitForTerminalContent(
      input.page,
      (content) => content.includes("WORKLOAD_READY"),
      STRESS_TIMEOUT_MS,
    );

    await resetTerminalKeystrokeStressProbe(input.page);

    for (const char of INPUT_TEXT) {
      input.harness.client.sendTerminalInput(appTerminal.id, {
        type: "input",
        data: char,
      });
    }

    await waitForAppStressEcho(input.page, INPUT_TEXT);
    await waitForAppProbePayload(input.page, INPUT_TEXT.length);

    return readTerminalKeystrokeStressReport(input.page, INPUT_TEXT);
  } finally {
    await input.harness.killTerminal(appTerminal.id);
  }
}

async function measureNodeWorkload(input: {
  page: Page;
  harness: TerminalE2EHarness;
}): Promise<
  ReturnType<typeof readTerminalKeystrokeStressReport> extends Promise<infer T> ? T : never
> {
  const tokenPrefix = `WORKLOAD_TOKEN_${Date.now().toString(36)}`;
  const inputEchoes = Array.from({ length: WORKLOAD_INPUT_COUNT }, (_, seq) => ({
    seq,
    nonce: `${tokenPrefix}_nonce_${seq}`,
  }));
  const terminal = await input.harness.createTerminal({
    name: "cross-platform-node-workload-combined",
    command: process.execPath,
    args: [
      WORKLOAD_FIXTURE,
      "--count",
      String(WORKLOAD_OUTPUT_COUNT),
      "--interval-ms",
      "2",
      "--token",
      tokenPrefix,
    ],
  });
  const largePayloadAgentTitle = "Combined terminal large payload";
  const largePayloadAgent = await input.harness.client.createAgent({
    provider: "mock",
    cwd: input.harness.tempRepo.path,
    workspaceId: input.harness.workspaceId,
    title: largePayloadAgentTitle,
    modeId: "load-test",
  });
  const tokenText = inputEchoes.map((echo) => `${tokenPrefix}:${echo.seq}:${echo.nonce}`);
  const browserInputText = ["GO", ...tokenText].join("");
  const workloadAgentIds = [largePayloadAgent.id];
  try {
    await input.harness.openTerminal(input.page, { terminalId: terminal.id });
    await waitForTerminalContent(
      input.page,
      (content) => content.includes("WORKLOAD_READY"),
      STRESS_TIMEOUT_MS,
    );
    await openAgentRoute(input.page, {
      workspaceId: input.harness.workspaceId,
      agentId: largePayloadAgent.id,
    });
    await expect(
      input.page.getByRole("button", { name: largePayloadAgentTitle, exact: true }),
    ).toBeVisible();
    await runWorkspaceActionFromCommandCenter(input.page, "Split pane right");
    await input.page.getByTestId(`workspace-tab-terminal_${terminal.id}`).first().click();
    await runWorkspaceActionFromCommandCenter(input.page, "Move tab right");
    await expect(input.page.getByRole("textbox", { name: "Message agent..." })).toHaveCount(1);
    await waitForTerminalContent(
      input.page,
      (content) => content.includes("WORKLOAD_READY"),
      STRESS_TIMEOUT_MS,
    );

    const terminalSurface = input.harness.terminalSurface(input.page);
    await terminalSurface.click();
    await resetTerminalKeystrokeStressProbe(input.page);
    await Promise.all(
      workloadAgentIds.map((agentId) =>
        emitRapidAgentStreamUpdates(input.harness, { agentId, count: 1 }).then(() =>
          waitForAgentTurn(input.harness, agentId),
        ),
      ),
    );
    await waitForAppAgentStreams(input.page, workloadAgentIds);
    await input.page.waitForTimeout(100);
    await resetTerminalKeystrokeStressProbe(input.page);
    await terminalSurface.pressSequentially("GO", { delay: 0 });
    await terminalSurface.press("Enter");
    await waitForTerminalContent(
      input.page,
      (content) => content.includes("OUT:0:"),
      STRESS_TIMEOUT_MS,
    );

    const activeAgentLoadPromise = emitCombinedAgentLoad(input.harness, {
      agentId: largePayloadAgent.id,
      bigDiffBytes: WORKLOAD_BIG_DIFF_BYTES,
      streamUpdateCount: WORKLOAD_AGENT_STREAM_UPDATE_COUNT,
    });
    for (const text of tokenText) {
      await terminalSurface.pressSequentially(text, { delay: 0 });
      await terminalSurface.press("Enter");
    }

    await waitForTerminalTailText(
      input.page,
      `WORKLOAD_DONE:${WORKLOAD_OUTPUT_COUNT}:`,
      STRESS_TIMEOUT_MS,
    );
    await activeAgentLoadPromise;
    const reportOptions = {
      expectedSequenceCount: WORKLOAD_OUTPUT_COUNT,
      expectedOutputPayload: WORKLOAD_OUTPUT_PAYLOAD,
      expectedInputEchoes: inputEchoes,
      expectedOutputDigest: workloadDigest(WORKLOAD_OUTPUT_COUNT, WORKLOAD_OUTPUT_PAYLOAD),
    };
    await waitForWorkloadIntegrity(input.page, {
      inputText: browserInputText,
      expectedAgentIds: workloadAgentIds,
      ...reportOptions,
    });
    return readTerminalKeystrokeStressReport(input.page, browserInputText, reportOptions);
  } finally {
    await input.harness.killTerminal(terminal.id);
  }
}

async function emitCombinedAgentLoad(
  harness: TerminalE2EHarness,
  input: {
    agentId: string;
    bigDiffBytes: number;
    streamUpdateCount: number;
  },
): Promise<void> {
  await emitRapidAgentStreamUpdates(harness, {
    agentId: input.agentId,
    count: input.streamUpdateCount,
  });
  await waitForAgentTurn(harness, input.agentId);
  await emitLargeDiffAgentPayload(harness, {
    agentId: input.agentId,
    bytes: input.bigDiffBytes,
  });
  await waitForAgentTurn(harness, input.agentId);
}

async function waitForAgentTurn(harness: TerminalE2EHarness, agentId: string): Promise<void> {
  const result = await harness.client.waitForFinish(agentId, STRESS_TIMEOUT_MS);
  if (result.status !== "idle" || result.final?.lastError) {
    throw new Error(`Combined terminal workload agent turn failed: ${JSON.stringify(result)}`);
  }
}

function workloadDigest(count: number, payload = "x"): string {
  const digest = createHash("sha256");
  for (let index = 0; index < count; index += 1) {
    digest.update(`OUT:${index}:${payload}\n`);
  }
  return digest.digest("hex");
}

async function waitForAppAgentStreams(page: Page, expectedAgentIds: string[]): Promise<void> {
  const deadline = Date.now() + STRESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const report = await readTerminalKeystrokeStressReport(page, "");
    if (expectedAgentIds.every((agentId) => report.agentStreamAgentIds.includes(agentId))) {
      return;
    }
    await page.waitForTimeout(25);
  }
  const report = await readTerminalKeystrokeStressReport(page, "");
  throw new Error(
    `Timed out waiting for browser agent streams: ${JSON.stringify(report.agentStreamAgentIds)}`,
  );
}

async function waitForWorkloadIntegrity(
  page: Page,
  input: {
    inputText: string;
    expectedInputEchoes: Array<{ seq: number; nonce: string }>;
    expectedSequenceCount: number;
    expectedOutputPayload: string;
    expectedOutputDigest: string;
    expectedAgentIds: string[];
  },
): Promise<void> {
  const deadline = Date.now() + STRESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const report = await readTerminalKeystrokeStressReport(page, input.inputText, {
      expectedSequenceCount: input.expectedSequenceCount,
      expectedOutputPayload: input.expectedOutputPayload,
      expectedInputEchoes: input.expectedInputEchoes,
      expectedOutputDigest: input.expectedOutputDigest,
    });
    if (
      report.outputSequenceCount === input.expectedSequenceCount &&
      report.outputSequenceMissingCount === 0 &&
      report.outputSequenceDuplicateCount === 0 &&
      report.outputSequenceOutOfOrderCount === 0 &&
      report.outputSequenceMalformedCount === 0 &&
      report.outputPayloadMismatchCount === 0 &&
      report.inputEchoCount === input.expectedInputEchoes.length &&
      report.inputEchoMissingCount === 0 &&
      report.inputEchoDuplicateCount === 0 &&
      report.inputEchoOutOfOrderCount === 0 &&
      report.inputEchoUnexpectedCount === 0 &&
      report.inputEchoMalformedCount === 0 &&
      report.outputDoneMarkerCount === 1 &&
      report.outputDoneDigestValid === true &&
      input.expectedAgentIds.every((agentId) => report.agentStreamAgentIds.includes(agentId))
    ) {
      return;
    }
    await page.waitForTimeout(25);
  }
  const report = await readTerminalKeystrokeStressReport(page, input.inputText, {
    expectedSequenceCount: input.expectedSequenceCount,
    expectedOutputPayload: input.expectedOutputPayload,
    expectedInputEchoes: input.expectedInputEchoes,
    expectedOutputDigest: input.expectedOutputDigest,
  });
  throw new Error(`Timed out waiting for combined workload integrity: ${JSON.stringify(report)}`);
}

async function emitRapidAgentStreamUpdates(
  harness: TerminalE2EHarness,
  input: { agentId: string; count: number },
): Promise<void> {
  await harness.client.sendAgentMessage(input.agentId, `emit ${input.count} agent stream updates`);
}

async function emitLargeDiffAgentPayload(
  harness: TerminalE2EHarness,
  input: { agentId: string; bytes: number },
): Promise<void> {
  await harness.client.sendAgentMessage(
    input.agentId,
    `emit ${input.bytes} byte large diff agent stream update`,
  );
}

async function measureDaemonBurstEcho(
  harness: TerminalE2EHarness,
  terminal: TerminalInstance,
  inputText: string,
): Promise<DaemonEchoReport> {
  await harness.client.subscribeTerminal(terminal.id);

  const outputTimesByByte: number[] = [];
  let outputEventCount = 0;
  let echoedBytes = 0;
  const decoder = new TextDecoder();
  const unsubscribe = harness.client.onTerminalStreamEvent((event) => {
    if (event.terminalId !== terminal.id || event.type !== "output" || !event.data) {
      return;
    }
    outputEventCount += 1;
    const text = decoder.decode(event.data);
    const now = performance.now();
    const previousEchoedBytes = echoedBytes;
    echoedBytes += text.length;
    for (let index = previousEchoedBytes; index < echoedBytes; index += 1) {
      outputTimesByByte[index] = now;
    }
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    outputEventCount = 0;
    echoedBytes = 0;
    outputTimesByByte.length = 0;

    const sendTimes: number[] = [];
    for (const char of inputText) {
      sendTimes.push(performance.now());
      harness.client.sendTerminalInput(terminal.id, {
        type: "input",
        data: char,
      });
    }

    await waitForDaemonEchoBytes({
      getEchoedBytes: () => echoedBytes,
      expectedBytes: inputText.length,
      timeoutMs: STRESS_TIMEOUT_MS,
    });

    const latencies = sendTimes.map((sentAt, index) => outputTimesByByte[index] - sentAt);
    return {
      inputTextLength: inputText.length,
      inputFrameCount: sendTimes.length,
      outputEventCount,
      echoedBytes,
      sendToOutputMs: summarizeLatency(latencies),
      firstSendAt: sendTimes[0] ?? 0,
      lastOutputAt: outputTimesByByte[inputText.length - 1] ?? 0,
    };
  } finally {
    unsubscribe();
  }
}

async function waitForDaemonEchoBytes(input: {
  getEchoedBytes: () => number;
  expectedBytes: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (input.getEchoedBytes() >= input.expectedBytes) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for daemon echo bytes: ${input.getEchoedBytes()}/${input.expectedBytes}`,
  );
}

async function waitForAppStressEcho(page: Page, text: string): Promise<void> {
  const tail = text.slice(-80);
  await waitForTerminalContent(page, (content) => content.includes(tail), STRESS_TIMEOUT_MS);
}

async function waitForAppProbePayload(page: Page, expectedBytes: number): Promise<void> {
  const deadline = Date.now() + STRESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const report = await readTerminalKeystrokeStressReport(page, INPUT_TEXT);
    if (report.outputFramePayloadBytes >= expectedBytes) {
      return;
    }
    await page.waitForTimeout(25);
  }
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}

function buildStressText(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let output = "";
  while (output.length < length) {
    output += alphabet;
  }
  return output.slice(0, length);
}

function summarizeLatency(values: number[]): LatencyStats {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
  };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    minMs: round2(sorted[0] ?? 0),
    p50Ms: round2(percentile(50)),
    p95Ms: round2(percentile(95)),
    maxMs: round2(sorted[sorted.length - 1] ?? 0),
    avgMs: round2(total / values.length),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function expectFrameBudgets(report: { rafMaxGapMs: number; longTaskMaxMs: number }): void {
  expect(report.rafMaxGapMs).toBeLessThan(1000);
  expect(report.longTaskMaxMs).toBeLessThan(1000);
}
