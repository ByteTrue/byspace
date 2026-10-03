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

    const parentBox = await parentBadge.boundingBox();
    const childBox = await childBadge.boundingBox();
    expect(parentBox).not.toBeNull();
    expect(childBox).not.toBeNull();
    expect((childBox?.x ?? 0) - (parentBox?.x ?? 0)).toBeGreaterThanOrEqual(16);

    const zoomBox = await badges.filter({ hasText: "Codemode" }).first().boundingBox();
    await testInfo.attach("nested-codemode-rows", {
      body: await page.screenshot({
        path: testInfo.outputPath("nested-codemode-rows.png"),
        clip: zoomBox
          ? {
              x: zoomBox.x - 24,
              y: zoomBox.y - 12,
              width: 460,
              height: (childBox?.y ?? zoomBox.y) - zoomBox.y + (childBox?.height ?? 0) + 24,
            }
          : undefined,
      }),
      contentType: "image/png",
    });
  } finally {
    await agent.cleanup();
  }
});
