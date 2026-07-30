import { expect, type Page } from "@playwright/test";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { test } from "./fixtures";
import { seedWorkspace, type SeedDaemonClient } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { observeTimelineSubscriptions } from "./helpers/timeline-delivery";
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
  const [firstAgent, secondAgent] = await Promise.all([
    createAgent("First viewed chat"),
    createAgent("Second viewed chat"),
  ]);
  return {
    client: workspace.client,
    workspaceId: workspace.workspaceId,
    firstAgentId: firstAgent.id,
    secondAgentId: secondAgent.id,
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
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
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

test.describe("Viewed agent timelines", () => {
  test("an unsubscribed hidden chat catches up when shown", async ({ page }) => {
    test.setTimeout(90_000);
    const subscriptions = observeTimelineSubscriptions(page);
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await selectAgent(page, "Second viewed chat");
      await subscriptions.waitForSubscribedAgents([scenario.secondAgentId], { timeout: 45_000 });
      await commitMessage(
        scenario,
        scenario.firstAgentId,
        "Committed after the first chat unsubscribed.",
      );
      await expect(
        page.getByText("Committed after the first chat unsubscribed.", { exact: true }),
      ).toHaveCount(0);
      await selectAgent(page, "First viewed chat");
      await expect(
        page.getByText("Committed after the first chat unsubscribed.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("(end of synthetic stream)", { exact: true })).toBeVisible();
    } finally {
      await page.close();
      await scenario.cleanup();
    }
  });

  test("a hidden retained chat stays current during unsubscribe grace", async ({ page }) => {
    test.setTimeout(60_000);
    const subscriptions = observeTimelineSubscriptions(page);
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await selectAgent(page, "Second viewed chat");
      await subscriptions.waitForSubscribedAgents([scenario.firstAgentId, scenario.secondAgentId]);
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
      await expect(page.getByText("(end of synthetic stream)", { exact: true })).toBeVisible();
    } finally {
      await page.close();
      await scenario.cleanup();
    }
  });

  test("two visible split chats both stay current", async ({ page }) => {
    const scenario = await seedViewedTimelineScenario();
    try {
      await enableMoveTabShortcut(page);
      await openAgent(page, scenario, scenario.firstAgentId);
      await page.getByRole("button", { name: "Split pane right" }).click();
      await selectAgent(page, "Second viewed chat");
      await moveActiveTabRight(page);
      await expect(
        page.getByRole("button", { name: "First viewed chat", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Second viewed chat", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message agent..." })).toHaveCount(2);
      await commitMessage(scenario, scenario.firstAgentId, "First visible pane update.");
      await expect(page.getByText("First visible pane update.", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Second viewed chat", exact: true }),
      ).toBeVisible();
    } finally {
      await page.close();
      await scenario.cleanup();
    }
  });

  test("refocusing a visible chat performs authoritative catch-up", async ({ page }) => {
    const gate = await installDaemonWebSocketGate(page);
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await expect
        .poll(() => gate.getClientRequestCount("fetch_agent_timeline_request"))
        .toBeGreaterThan(0);
      await expect
        .poll(
          () =>
            gate.getClientRequestCount("fetch_agent_timeline_request") -
            gate.getServerMessageCount("fetch_agent_timeline_response"),
        )
        .toBe(0);

      gate.holdResponseForNextClientRequest(
        "fetch_agent_timeline_request",
        "fetch_agent_timeline_response",
      );
      const beforeStaleRequest = gate.getClientRequestCount("fetch_agent_timeline_request");
      const beforeStaleResponse = gate.getServerMessageCount("fetch_agent_timeline_response");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect
        .poll(() => gate.getClientRequestCount("fetch_agent_timeline_request"))
        .toBeGreaterThan(beforeStaleRequest);
      await expect
        .poll(() => gate.getServerMessageCount("fetch_agent_timeline_response"))
        .toBeGreaterThan(beforeStaleResponse);

      gate.blockServerMessageType("agent_stream");
      await commitMessage(
        scenario,
        scenario.firstAgentId,
        "Committed while live timeline delivery was suspended.",
      );
      const missedMessage = page.getByText(
        "Committed while live timeline delivery was suspended.",
        { exact: true },
      );
      await expect(missedMessage).toHaveCount(0);
      const beforeFocus = gate.getClientRequestCount("fetch_agent_timeline_request");

      await page.evaluate(() => window.dispatchEvent(new Event("focus")));

      await expect
        .poll(() => gate.getClientRequestCount("fetch_agent_timeline_request"), { timeout: 1_000 })
        .toBeGreaterThan(beforeFocus);
      await expect(missedMessage).toBeVisible({ timeout: 2_000 });

      gate.releaseHeldServerMessages("fetch_agent_timeline_response");
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
      await expect(missedMessage).toBeVisible();
    } finally {
      await page.close();
      await scenario.cleanup();
    }
  });

  test("returning to a retained chat immediately catches up missed delivery", async ({ page }) => {
    test.setTimeout(60_000);
    const gate = await installDaemonWebSocketGate(page);
    const subscriptions = observeTimelineSubscriptions(page);
    const scenario = await seedViewedTimelineScenario();
    try {
      await openAgent(page, scenario, scenario.firstAgentId);
      await selectAgent(page, "Second viewed chat");
      await subscriptions.waitForSubscribedAgents([scenario.firstAgentId, scenario.secondAgentId]);
      gate.blockServerMessageType("agent_stream");
      await commitMessage(
        scenario,
        scenario.firstAgentId,
        "Committed while the retained chat missed live delivery.",
      );
      const missedMessage = page.getByText(
        "Committed while the retained chat missed live delivery.",
        { exact: true },
      );
      await expect(missedMessage).toHaveCount(0);
      const beforeReturn = gate.getClientRequestCount("fetch_agent_timeline_request");

      await selectAgent(page, "First viewed chat");

      await expect
        .poll(() => gate.getClientRequestCount("fetch_agent_timeline_request"), { timeout: 1_000 })
        .toBeGreaterThan(beforeReturn);
      await expect(missedMessage).toBeVisible({ timeout: 2_000 });
    } finally {
      await page.close();
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
      await page.close();
      await scenario.cleanup();
    }
  });
});
