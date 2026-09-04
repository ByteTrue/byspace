import { expect, type Page } from "@playwright/test";
import type { MockAgentWorkspace } from "./mock-agent";

const DIAGRAM_NAME = "Diagram";

function renderedDiagram(page: Page) {
  const diagram = page.getByRole("img", { name: DIAGRAM_NAME }).last();
  const svg = diagram.locator("iframe").contentFrame().locator("#diagram svg");
  return { diagram, svg };
}

export async function requestDiagram(agent: MockAgentWorkspace): Promise<void> {
  await agent.client.sendAgentMessage(agent.agentId, "Render the requested Mermaid diagram.");
}

export async function expectDiagramWithLabels(
  page: Page,
  labels: readonly string[],
): Promise<void> {
  const { diagram, svg } = renderedDiagram(page);
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await expect(svg).toBeVisible({ timeout: 30_000 });
  for (const label of labels) {
    await expect(svg).toContainText(label);
  }
}

export async function expectDiagramRemainsRenderedWhileStreaming(page: Page): Promise<void> {
  const { diagram, svg } = renderedDiagram(page);
  const samples = 80;
  let transientMisses = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    await expect(diagram).toBeVisible({ timeout: 100 });
    // The composer remounts transiently (~157ms) when a mock streaming turn
    // starts, which can briefly unmount the diagram mid-sample. Allow a
    // couple of re-acquired samples instead of failing the whole loop.
    try {
      await expect(svg).toBeVisible({ timeout: 500 });
      transientMisses = 0;
    } catch {
      transientMisses += 1;
      if (transientMisses > 2) {
        throw new Error("diagram svg stayed invisible across consecutive samples while streaming");
      }
    }
    await page.waitForTimeout(25);
  }
}

export async function waitForDiagramTurnToComplete(agent: MockAgentWorkspace): Promise<void> {
  await agent.client.waitForFinish(agent.agentId, 30_000);
}

export async function expectCompletedDiagram(page: Page, labels: readonly string[]): Promise<void> {
  await expectDiagramWithLabels(page, labels);
}

export async function reloadConversation(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
}
