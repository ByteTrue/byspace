import { expect, test, type Page } from "./fixtures";
import { expectComposerVisible } from "./helpers/composer";
import { daemonWsRoutePattern } from "./helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

type WebSocketMessage = string | Buffer;

const RAW_TRANSCRIPT = "test our voice input quality";
const CLEAN_TRANSCRIPT = "Test our voice input quality.";
const REFINEMENT_ERROR = "Synthetic AI provider failure";

function parseEnvelope(message: WebSocketMessage): {
  type?: unknown;
  message?: Record<string, unknown>;
} | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw) as { type?: unknown; message?: Record<string, unknown> };
  } catch {
    return null;
  }
}

function sessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseEnvelope(message);
  return envelope?.type === "session" && envelope.message ? envelope.message : null;
}

function sendSessionMessage(
  ws: { send(message: string): void },
  message: Record<string, unknown>,
): void {
  ws.send(JSON.stringify({ type: "session", message }));
}

function enableDictationCapability(message: WebSocketMessage): WebSocketMessage {
  const envelope = parseEnvelope(message);
  const payload = envelope?.message?.payload;
  if (
    envelope?.message?.type !== "status" ||
    !payload ||
    typeof payload !== "object" ||
    (payload as { status?: unknown }).status !== "server_info"
  ) {
    return message;
  }
  (payload as Record<string, unknown>).capabilities = {
    voice: {
      dictation: { enabled: true, reason: "" },
      voice: { enabled: false, reason: "Realtime voice is disabled in this test." },
    },
  };
  return JSON.stringify(envelope);
}

async function installSyntheticMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
}

async function installDictationRefinementHarness(page: Page) {
  let audioChunkCount = 0;
  let refinementResult: "success" | "failure" = "success";

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const request = sessionMessage(message);
      const type = request?.type;
      const dictationId = typeof request?.dictationId === "string" ? request.dictationId : null;

      if (type === "dictation_stream_start" && dictationId) {
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: -1 },
        });
        return;
      }
      if (type === "dictation_stream_chunk" && dictationId) {
        const seq = typeof request?.seq === "number" ? request.seq : 0;
        audioChunkCount += 1;
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: seq },
        });
        return;
      }
      if (type === "dictation_stream_finish" && dictationId) {
        sendSessionMessage(ws, {
          type: "dictation_stream_finish_accepted",
          payload: { dictationId, timeoutMs: 5_000 },
        });
        sendSessionMessage(ws, {
          type: "dictation_stream_final",
          payload: { dictationId, text: RAW_TRANSCRIPT },
        });
        return;
      }
      if (type === "speech.dictation.refine.request" && typeof request?.requestId === "string") {
        sendSessionMessage(ws, {
          type: "speech.dictation.refine.response",
          payload: {
            requestId: request.requestId,
            text: refinementResult === "success" ? CLEAN_TRANSCRIPT : RAW_TRANSCRIPT,
            refined: refinementResult === "success",
            ...(refinementResult === "failure" ? { error: REFINEMENT_ERROR } : {}),
          },
        });
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(enableDictationCapability(message)));
  });

  return {
    getAudioChunkCount: () => audioChunkCount,
    failNextRefinement: () => {
      refinementResult = "failure";
    },
  };
}

async function dictate(page: Page, getAudioChunkCount: () => number) {
  const expectedAudioChunks = getAudioChunkCount() + 1;
  await page.getByRole("button", { name: "Start dictation" }).click();
  await expect.poll(getAudioChunkCount).toBeGreaterThanOrEqual(expectedAudioChunks);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
}

test("shows dictation refinement status above the composer and explains failures", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "dictation-refinement-feedback-",
    title: "Dictation refinement feedback",
  });
  await agent.client.patchDaemonConfig({ dictation: { refineWithAgent: true } });
  await installSyntheticMicrophone(page);
  const harness = await installDictationRefinementHarness(page);

  try {
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);
    const composer = page.getByRole("textbox", { name: "Message agent..." });

    await dictate(page, harness.getAudioChunkCount);
    await expect(composer).toHaveValue(CLEAN_TRANSCRIPT);
    const notice = page.getByTestId("dictation-refinement-notice");
    await expect(notice).toContainText("AI-cleaned transcript");
    const surface = page.getByTestId("message-input-surface");
    const noticeHandle = await notice.elementHandle();
    expect(noticeHandle).not.toBeNull();
    expect(
      await surface.evaluate((node, candidate) => !node.contains(candidate), noticeHandle),
    ).toBe(true);

    await page.getByTestId("dictation-refinement-toggle").click();
    await expect(composer).toHaveValue(RAW_TRANSCRIPT);
    await composer.fill("");
    harness.failNextRefinement();

    await dictate(page, harness.getAudioChunkCount);
    await expect(composer).toHaveValue(RAW_TRANSCRIPT);
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice).toContainText(
      `AI cleanup failed; original transcript kept. ${REFINEMENT_ERROR}`,
    );
  } finally {
    await agent.client
      .patchDaemonConfig({ dictation: { refineWithAgent: false } })
      .catch(() => undefined);
    await agent.cleanup();
  }
});
