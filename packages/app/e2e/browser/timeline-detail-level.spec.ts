import { test, expect } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { startRunningMockAgent } from "../support/helpers/composer";

const SETTINGS_KEY = "@byspace:app-settings";

/**
 * "Thinking" expander rows (tool-call badges), keyed by their aria-expanded state. The badge
 * testID sits on the container; the expanded state lives on the inner pressable button.
 */
async function thinkingRowStates(page: import("@playwright/test").Page) {
  return page
    .getByTestId("tool-call-badge")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node.textContent ?? "").includes("Thinking"))
        .map((node) => node.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") ?? ""),
    );
}

function setTimelineDetailLevel(page: import("@playwright/test").Page, level: string) {
  return page.addInitScript(
    ({ key, value }) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...stored, timelineDetailLevel: value }));
    },
    { key: SETTINGS_KEY, value: level },
  );
}

/** Distance in px between the scroll area's bottom edge and its tail. */
async function tailDistance(scroll: import("@playwright/test").Locator): Promise<number> {
  return scroll.evaluate((node) => {
    const area = node as HTMLElement;
    return area.scrollHeight - (area.scrollTop + area.clientHeight);
  });
}

test.describe("Timeline detail level", () => {
  test("overview collapses thinking, expanded opens every block", async ({ page }) => {
    test.setTimeout(180_000);
    await setTimelineDetailLevel(page, "overview");
    const agent = await startRunningMockAgent(page, {
      prefix: "timeline-detail-overview-",
      model: "ten-second-stream",
      prompt: "Stream reasoning and tool calls for the overview level.",
    });
    try {
      await expectAgentIdle(page);

      const overviewStates = await thinkingRowStates(page);
      expect(overviewStates.length).toBeGreaterThan(0);
      expect(overviewStates.every((state) => state === "false")).toBe(true);

      await setTimelineDetailLevel(page, "expanded");
      await page.reload();
      await expect
        .poll(async () => (await thinkingRowStates(page)).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      const expandedStates = await thinkingRowStates(page);
      expect(expandedStates.every((state) => state === "true")).toBe(true);
    } finally {
      await agent.cleanup();
    }
  });

  test("live mode keeps only the newest thinking block expanded and pinned to its tail", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTimelineDetailLevel(page, "live");
    const agent = await startRunningMockAgent(page, {
      prefix: "timeline-detail-live-",
      model: "ten-second-stream",
      prompt: "Stream reasoning and tool calls for the live level.",
      featureValues: { mockReasoningRepeat: 12 },
    });
    try {
      const onlyNewestExpanded = (states: string[]) => {
        const expandedCount = states.filter((state) => state === "true").length;
        return states.length >= 2 && expandedCount === 1 && states.at(-1) === "true";
      };

      // Wait for the first turn's thinking block, then send a second message so a second
      // block streams in while the first sits ready in history.
      await expect
        .poll(async () => (await thinkingRowStates(page)).length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(1);
      await expectAgentIdle(page);
      await agent.client.sendAgentMessage(agent.agentId, "Second turn: keep reasoning.");

      // While the second block streams, it alone stays expanded and the first folds back.
      await expect
        .poll(async () => onlyNewestExpanded(await thinkingRowStates(page)), {
          timeout: 60_000,
        })
        .toBe(true);

      // The expanded block's scroll area stays pinned to the newest lines while it streams.
      const scroll = page.getByTestId("thinking-detail-scroll").last();
      await expect.poll(() => tailDistance(scroll)).toBeLessThanOrEqual(40);

      // Scrolling up stops the pin; new content must not yank the reader back down.
      await scroll.hover();
      await page.mouse.wheel(0, -600);
      await expect.poll(() => tailDistance(scroll)).toBeGreaterThan(100);
      await page.waitForTimeout(1_500);
      expect(await tailDistance(scroll)).toBeGreaterThan(100);
    } finally {
      await agent.cleanup();
    }
  });
});
