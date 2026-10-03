import { test, expect } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The mock provider runs a codemode script per cycle (glob + read + bash). The child rows must be
// visible without expanding anything, indented under the parent, and the parent badge must carry
// the call counts, so the containment reads as one action instead of separate calls.
test("renders nested codemode rows expanded under an indented parent", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "nested-codemode-rows-",
    title: "Nested codemode rows",
    model: "ten-second-stream",
  });

  try {
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Exercise nested codemode rows.");

    const badges = page.getByTestId("tool-call-badge");
    const parentBadge = badges.filter({ hasText: "Codemode" }).first();
    await expect(parentBadge).toBeVisible({ timeout: 60_000 });
    await expect(parentBadge).toContainText("ran 1 command");

    const childBadge = badges.filter({ hasText: "npx vitest run --bail=1" }).first();
    await expect(childBadge).toBeVisible({ timeout: 30_000 });
    await expect(badges.filter({ hasText: "nested-codemode.ts" }).first()).toBeVisible();
    await expect(badges.filter({ hasText: "*.test.ts" }).first()).toBeVisible();

    const parentBox = await parentBadge.boundingBox();
    const childBox = await childBadge.boundingBox();
    if (!parentBox || !childBox) {
      throw new Error("Nested codemode rows did not render with a measurable box");
    }
    // Indented to the right of the parent, and below it: the children read as the script's calls,
    // not as calls the agent made on its own.
    expect(childBox.x - parentBox.x).toBeGreaterThanOrEqual(16);
    expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y + parentBox.height);

    await testInfo.attach("nested-codemode-rows", {
      body: await page.screenshot({
        path: testInfo.outputPath("nested-codemode-rows.png"),
        clip: {
          x: parentBox.x - 24,
          y: parentBox.y - 12,
          width: 460,
          height: childBox.y + childBox.height - parentBox.y + 24,
        },
      }),
      contentType: "image/png",
    });
  } finally {
    await agent.cleanup();
  }
});
