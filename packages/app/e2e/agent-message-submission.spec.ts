import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  attachImageFromMenu,
  expectAttachmentPill,
  expectComposerVisible,
} from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { getServerId } from "./helpers/server-id";
import { installDaemonWebSocketGate } from "./helpers/daemon-websocket-gate";
import {
  expectResumeOverflowFallsBackToOneTail,
  rememberTimelineRequestCounts,
} from "./helpers/timeline-resume";
import { observeTimelineSubscriptions } from "./helpers/timeline-delivery";
import { workspaceDeckEntryLocator } from "./helpers/workspace-ui";

const IMAGE = {
  name: "message-submission.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function submitMessageWithImage(page: Page, prompt: string): Promise<Locator> {
  await attachImageFromMenu(page, IMAGE);
  await expectAttachmentPill(page, "composer-image-attachment-pill");
  const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
  await composer.fill(prompt);
  await composer.press("Enter");
  return page.getByTestId("user-message").filter({ hasText: prompt }).last();
}

async function expectRenderedBefore(first: Locator, second: Locator): Promise<void> {
  const secondElement = await second.elementHandle();
  if (!secondElement) throw new Error("Expected the second timeline item to be rendered");
  expect(
    await first.evaluate(
      (firstElement, secondNode) =>
        Boolean(
          firstElement.compareDocumentPosition(secondNode) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      secondElement,
    ),
  ).toBe(true);
}

test.describe("Agent message submission", () => {
  test("keeps a streaming hidden submission before its output after workspace eviction", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const subscriptions = observeTimelineSubscriptions(page);
    const gate = await installDaemonWebSocketGate(page);
    const target = await seedMockAgentWorkspace({
      repoPrefix: `submission-hidden-stream-${testInfo.workerIndex}-`,
      title: "Hidden streaming submission",
      model: "ten-second-stream",
    });
    const evictionAgents = await Promise.all(
      Array.from({ length: 3 }, (_unused, index) =>
        seedMockAgentWorkspace({
          repoPrefix: `submission-workspace-eviction-${testInfo.workerIndex}-${index}-`,
          title: `Workspace eviction ${index + 1}`,
        }),
      ),
    );
    const prompt = "Keep this hidden image prompt before its streaming output.";
    const targetDeckEntry = workspaceDeckEntryLocator(page, getServerId(), target.workspaceId);

    try {
      await openAgentRoute(page, target);
      await expectComposerVisible(page);
      await subscriptions.waitForSubscribedAgents([target.agentId]);

      const userMessageCount = gate.getAgentStreamItemCount("user_message");
      gate.setAgentStreamSuppressed(true);
      const promptRow = await submitMessageWithImage(page, prompt);
      await gate.waitForAgentStreamItem("user_message", userMessageCount + 1);

      for (const evictionAgent of evictionAgents) {
        await openAgentRoute(page, evictionAgent);
        await expectComposerVisible(page);
      }
      await expect(targetDeckEntry).toHaveCount(0);
      await subscriptions.waitForSubscribedAgents([evictionAgents[2]!.agentId]);
      gate.setAgentStreamSuppressed(false);

      await target.client.waitForFinish(target.agentId, 30_000);
      const requestsBeforeReturn = rememberTimelineRequestCounts(gate);
      await openAgentRoute(page, target);
      await expectComposerVisible(page);
      await subscriptions.waitForSubscribedAgents([target.agentId]);

      const response = page.getByText("(end of synthetic stream)", { exact: true }).last();
      await expect(promptRow).toBeVisible();
      await expect(response).toBeVisible();
      await expectRenderedBefore(promptRow, response);
      expectResumeOverflowFallsBackToOneTail(gate, requestsBeforeReturn);
    } finally {
      gate.setAgentStreamSuppressed(false);
      gate.restore();
      await Promise.all([...evictionAgents.map((agent) => agent.cleanup()), target.cleanup()]);
    }
  });
});
