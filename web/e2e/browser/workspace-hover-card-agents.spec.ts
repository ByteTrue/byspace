import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";

function workspaceRowTestId(workspaceId: string): string {
  return `sidebar-workspace-row-${getServerId()}:${workspaceId}`;
}

async function waitForWorkspaceRow(page: Page, workspaceId: string) {
  const row = page.getByTestId(workspaceRowTestId(workspaceId));
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

async function openWorkspaceHoverCard(page: Page, workspaceId: string) {
  const row = await waitForWorkspaceRow(page, workspaceId);
  await row.hover();
  const card = page.getByTestId("workspace-hover-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toBeInViewport();
  return { card, row };
}

async function movePointerFromRowIntoCard(
  page: Page,
  row: import("@playwright/test").Locator,
  card: import("@playwright/test").Locator,
) {
  const rowBounds = await row.boundingBox();
  const cardBounds = await card.boundingBox();
  if (!rowBounds || !cardBounds) {
    throw new Error("Could not measure the workspace hover trigger and card");
  }

  await page.mouse.move(rowBounds.x + rowBounds.width / 2, rowBounds.y + rowBounds.height / 2);
  await page.mouse.move(cardBounds.x + cardBounds.width / 2, cardBounds.y + cardBounds.height / 2, {
    steps: 12,
  });
  await expect(card).toBeVisible();
}

test("workspace hover card shows every live agent with exact state labels", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workspace = await seedWorkspace({ repoPrefix: "workspace-hover-card-agents-" });
  try {
    const idleAgent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Hover idle agent",
      model: "e2e-fast-stream",
    });
    await workspace.client.waitForAgentUpsert(
      idleAgent.id,
      (snapshot) => snapshot.status === "idle",
      30_000,
    );

    const errorAgent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Hover error agent",
      model: "ten-second-stream",
    });
    await workspace.client.waitForAgentUpsert(
      errorAgent.id,
      (snapshot) => snapshot.status === "idle",
      30_000,
    );
    await workspace.client.sendAgentMessage(errorAgent.id, "Emit a synthetic turn failure.");
    const errorSnapshot = await workspace.client.waitForFinish(errorAgent.id, 30_000);
    expect(errorSnapshot.status).toBe("error");

    await gotoAppShell(page);
    const { card, row } = await openWorkspaceHoverCard(page, workspace.workspaceId);
    await movePointerFromRowIntoCard(page, row, card);

    await expect(
      card.getByTestId(`hover-card-agent-title-${getServerId()}:${idleAgent.id}`),
    ).toHaveText("Hover idle agent");
    await expect(
      card.getByTestId(`hover-card-agent-status-${getServerId()}:${idleAgent.id}`),
    ).toHaveText("Idle");
    await expect(
      card.getByTestId(`hover-card-agent-title-${getServerId()}:${errorAgent.id}`),
    ).toHaveText("Hover error agent");
    await expect(
      card.getByTestId(`hover-card-agent-status-${getServerId()}:${errorAgent.id}`),
    ).toHaveText("Error");

    const liveAgent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Hover live agent",
      model: "one-minute-stream",
      initialPrompt: "Keep this agent running for the hover card proof.",
    });
    await workspace.client.waitForAgentUpsert(
      liveAgent.id,
      (snapshot) => snapshot.status === "running",
      30_000,
    );
    await expect(
      card.getByTestId(`hover-card-agent-title-${getServerId()}:${liveAgent.id}`),
    ).toHaveText("Hover live agent");
    await expect(
      card.getByTestId(`hover-card-agent-status-${getServerId()}:${liveAgent.id}`),
    ).toHaveText("Running");

    const screenshotPath = testInfo.outputPath("workspace-hover-card-agents.png");
    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    await testInfo.attach("workspace-hover-card-agents", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await workspace.client.waitForFinish(liveAgent.id, 75_000);
    await expect(card).toBeVisible();
    await expect(
      card.getByTestId(`hover-card-agent-status-${getServerId()}:${liveAgent.id}`),
    ).toHaveText("Idle");
  } finally {
    await workspace.cleanup();
  }
});
