import { expect, type Page } from "@playwright/test";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { test } from "./fixtures";
import { seedWorkspace, type SeedDaemonClient } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { getE2EDaemonPort } from "./helpers/daemon-port";
import { waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";
import { installDaemonWebSocketGate } from "./helpers/daemon-websocket-gate";
import {
  expectReconnectingToastGone,
  expectReconnectingToastVisible,
} from "./helpers/workspace-ui";

interface ViewedTimelineScenario {
  client: SeedDaemonClient;
  workspaceId: string;
  firstAgentId: string;
  secondAgentId: string;
  thirdAgentId: string;
  cleanup(): Promise<void>;
}

async function seedViewedTimelineScenario(): Promise<ViewedTimelineScenario> {
  const workspace = await seedWorkspace({ repoPrefix: "viewed-timelines-" });
  const createAgent = (title: string) =>
    workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title,
      modeId: "load-test",
      model: "ten-second-stream",
    });
  const [firstAgent, secondAgent, thirdAgent] = await Promise.all([
    createAgent("First viewed chat"),
    createAgent("Second viewed chat"),
    createAgent("Third hidden chat"),
  ]);
  return {
    client: workspace.client,
    workspaceId: workspace.workspaceId,
    firstAgentId: firstAgent.id,
    secondAgentId: secondAgent.id,
    thirdAgentId: thirdAgent.id,
    cleanup: workspace.cleanup,
  };
}

async function openAgent(page: Page, scenario: ViewedTimelineScenario, agentId: string) {
  await page.goto(buildHostAgentDetailRoute(getServerId(), agentId, scenario.workspaceId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
  );
  await waitForWorkspaceTabsVisible(page);
}

async function selectAgent(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
}

async function enableMoveTabShortcut(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "byspace:keyboard-shortcut:workspace.pane.move-tab.right",
      "Meta+Alt+Shift+ArrowRight",
    );
  });
}

async function moveActiveTabRight(page: Page) {
  await page.keyboard.press("Meta+Alt+Shift+ArrowRight");
}

async function commitMessage(scenario: ViewedTimelineScenario, agentId: string, prompt: string) {
  await scenario.client.sendAgentMessage(agentId, prompt);
  const finish = await scenario.client.waitForFinish(agentId, 30_000);
  expect(finish.status).toBe("idle");
}

async function commitDeterministicFailure(
  scenario: ViewedTimelineScenario,
  agentId: string,
): Promise<void> {
  await scenario.client.sendAgentMessage(agentId, "Emit synthetic turn failure.");
  await scenario.client.waitForFinish(agentId, 30_000);
}

async function openLegacyTimelineSocket(page: Page): Promise<() => Promise<void>> {
  const url = `ws://127.0.0.1:${getE2EDaemonPort()}/ws`;
  await page.evaluate(
    ({ daemonUrl }) =>
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(daemonUrl);
        const legacyWindow = window as typeof window & { __legacyTimelineSocket?: WebSocket };
        legacyWindow.__legacyTimelineSocket = socket;
        socket.addEventListener(
          "error",
          () => reject(new Error("Legacy timeline WebSocket failed to connect")),
          { once: true },
        );
        socket.addEventListener(
          "open",
          () => {
            socket.send(
              JSON.stringify({
                type: "hello",
                clientId: "viewed-timeline-legacy-measurement",
                clientType: "browser",
                protocolVersion: 1,
              }),
            );
          },
          { once: true },
        );
        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;
          const envelope = JSON.parse(event.data);
          if (
            envelope.type === "session" &&
            envelope.message?.type === "status" &&
            envelope.message.payload?.status === "server_info"
          ) {
            resolve();
          }
        });
      }),
    { daemonUrl: url },
  );
  return () =>
    page.evaluate(() => {
      const legacyWindow = window as typeof window & { __legacyTimelineSocket?: WebSocket };
      legacyWindow.__legacyTimelineSocket?.close(1000, "measurement complete");
      delete legacyWindow.__legacyTimelineSocket;
    });
}

test.describe("Viewed agent timelines", () => {
  test("a hidden retained chat catches up when shown", async ({ page }) => {
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await selectAgent(page, "Second viewed chat");
      await commitMessage(
        scenario,
        scenario.firstAgentId,
        "Committed while the first chat is hidden.",
      );
      await expect(
        page.getByText("Committed while the first chat is hidden.", { exact: true }),
      ).toHaveCount(0);
      await selectAgent(page, "First viewed chat");
      await expect(
        page.getByText("Committed while the first chat is hidden.", { exact: true }),
      ).toBeVisible();
    } finally {
      await scenario.cleanup();
    }
  });

  test("two visible split chats both stay current", async ({ page }) => {
    const gate = await installDaemonWebSocketGate(page);
    await enableMoveTabShortcut(page);
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await page.getByRole("button", { name: "Split pane right" }).click();
      await selectAgent(page, "Second viewed chat");
      await moveActiveTabRight(page);
      await selectAgent(page, "First viewed chat");
      await expect(
        page.getByRole("button", { name: "First viewed chat", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Second viewed chat", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message agent..." })).toHaveCount(2);
      await expect
        .poll(() => gate.getAcknowledgedTimelineSubscriptions())
        .toContainEqual([scenario.firstAgentId, scenario.secondAgentId].sort());
      await commitMessage(scenario, scenario.firstAgentId, "First visible pane update.");
      await expect(page.getByText("First visible pane update.", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Second viewed chat", exact: true }),
      ).toBeVisible();
    } finally {
      gate.restore();
      await scenario.cleanup();
    }
  });

  test("a visible chat catches up after reconnecting", async ({ page }) => {
    const gate = await installDaemonWebSocketGate(page);
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await expect(page.getByRole("button", { name: "First viewed chat" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await gate.drop();
      await expectReconnectingToastVisible(page);
      await commitMessage(scenario, scenario.firstAgentId, "Committed while the chat reconnects.");
      await expect(
        page.getByText("Committed while the chat reconnects.", { exact: true }),
      ).toHaveCount(0);
      gate.restore();
      await expectReconnectingToastGone(page);
      const recoveredMessage = page.getByText("Committed while the chat reconnects.", {
        exact: true,
      });
      await expect(recoveredMessage).toHaveCount(1);
      await expect(recoveredMessage).toBeVisible();
    } finally {
      gate.restore();
      await scenario.cleanup();
    }
  });

  test("capable delivery omits hidden timelines while legacy delivery remains global", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const gate = await installDaemonWebSocketGate(page);
    const scenario = await seedViewedTimelineScenario();
    let closeLegacySocket: (() => Promise<void>) | null = null;
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await expect
        .poll(() => gate.hasAcknowledgedTimelineSubscription([scenario.firstAgentId]))
        .toBe(true);
      const timelineSubscriptionRequests = gate.getClientRequestCount(
        "agent.timeline.set_subscription.request",
      );
      expect(timelineSubscriptionRequests).toBeGreaterThan(0);
      closeLegacySocket = await openLegacyTimelineSocket(page);
      gate.resetTimelineTraffic();

      await Promise.all([
        commitDeterministicFailure(scenario, scenario.firstAgentId),
        commitDeterministicFailure(scenario, scenario.secondAgentId),
        commitDeterministicFailure(scenario, scenario.thirdAgentId),
      ]);

      const expectedLegacyAgentIds = [
        scenario.firstAgentId,
        scenario.secondAgentId,
        scenario.thirdAgentId,
      ].sort();
      await expect
        .poll(() => gate.getTimelineTraffic().legacy.agentIds)
        .toEqual(expectedLegacyAgentIds);
      await expect
        .poll(() => gate.getTimelineTraffic().capable.agentIds)
        .toEqual([scenario.firstAgentId]);
      const traffic = gate.getTimelineTraffic();
      expect(traffic.capable.timelineFrames).toBeLessThan(traffic.legacy.timelineFrames);
      expect(traffic.capable.timelineBytes).toBeLessThan(traffic.legacy.timelineBytes);
      expect(gate.getClientRequestCount("agent.timeline.set_subscription.request")).toBe(
        timelineSubscriptionRequests,
      );
      console.log(`SELECTIVE_TIMELINE_TRAFFIC ${JSON.stringify(traffic)}`);
    } finally {
      await closeLegacySocket?.().catch(() => undefined);
      gate.restore();
      await scenario.cleanup();
    }
  });
});
