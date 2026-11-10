import { test, expect } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { startRunningMockAgent } from "../support/helpers/composer";

/**
 * "Collapse all" folds reasoning into the turn's overview group; the group label and the
 * reasoning row a user sees after opening it both carry the measured think time, not a bare
 * "Thought". The mock's reasoning phrasing is long enough to pass a second.
 */
test("overview labels the folded reasoning with its measured duration", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "@byspace:app-settings",
      JSON.stringify({ timelineDetailLevel: "overview" }),
    );
  });
  const agent = await startRunningMockAgent(page, {
    prefix: "thought-duration-",
    model: "ten-second-stream",
    prompt: "Stream reasoning and tool calls.",
  });
  try {
    await expectAgentIdle(page);

    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();
    await expect(group).toContainText(/Thought for \d+s/i);

    await group.getByRole("button").first().click();
    const thinking = page.getByTestId("tool-call-badge").filter({ hasText: "Thinking" }).first();
    await expect(thinking).toBeVisible();
    await expect(thinking).toContainText(/\d+s/);
  } finally {
    await agent.cleanup();
  }
});
