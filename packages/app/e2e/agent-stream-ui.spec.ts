import { test, expect } from "./fixtures";
import type { ElementHandle } from "@playwright/test";
import {
  awaitAssistantMessage,
  expectAgentIdle,
  expectInlineWorkingIndicator,
  expectTurnCopyButton,
  expectScrollFollowsNewContent,
} from "./helpers/agent-stream";
import {
  expectNearBottom,
  expectScrollStaysFixed,
  readScrollMetrics,
  scrollAgentChatToBottom,
  scrollChatAwayFromBottom,
  waitForScrollableChat,
} from "./helpers/agent-bottom-anchor";
import {
  clickSessionRow,
  expectArchivedAgentFocused,
  expectSessionRowArchived,
  openSessions,
} from "./helpers/archive-tab";
import { delayCreatedAgentInitialTailResponse } from "./helpers/agent-timeline-gate";
import { selectModel } from "./helpers/app";
import { clickNewChat } from "./helpers/launcher";
import { expectComposerVisible, startRunningMockAgent } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

const SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE = 360;

async function isElementConnected(element: ElementHandle): Promise<boolean> {
  return element.evaluate((node) => node.isConnected);
}

test.describe("Agent stream UI", () => {
  test("auto-scroll sticks to bottom across token bursts", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "stream-scroll-",
      model: "one-minute-stream",
      prompt: "Stream for auto-scroll test.",
    });
    try {
      await awaitAssistantMessage(page);
      await expectScrollFollowsNewContent(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps the active Markdown root mounted across streamed text updates", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "stream-markdown-root-",
      model: "one-minute-stream",
      prompt: "Stream for Markdown root stability test.",
    });
    try {
      const assistantMessage = page.getByTestId("assistant-message").last();
      await expect(assistantMessage).toContainText("walking through", { timeout: 30_000 });

      const activeBlock = assistantMessage.locator(":scope > *").last();
      const initialText = (await activeBlock.textContent()) ?? "";
      const activeBlockHandle = await activeBlock.elementHandle();
      if (!activeBlockHandle) {
        throw new Error("Expected the active assistant message to contain a block");
      }
      const markdownRoot = await activeBlock.locator(":scope > *").first().elementHandle();
      if (!markdownRoot) {
        throw new Error("Expected the active assistant block to contain a Markdown root");
      }

      await page.evaluate((block) => {
        const evidence = {
          addedNodes: 0,
          characterDataMutations: 0,
          removedNodes: 0,
        };
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            evidence.addedNodes += record.addedNodes.length;
            evidence.removedNodes += record.removedNodes.length;
            if (record.type === "characterData") {
              evidence.characterDataMutations += 1;
            }
          }
        });
        observer.observe(block, { characterData: true, childList: true, subtree: true });
        Object.assign(window, {
          __markdownRootEvidence: evidence,
          __markdownRootObserver: observer,
        });
      }, activeBlockHandle);

      await expect
        .poll(async () => ((await activeBlock.textContent()) ?? "").length)
        .toBeGreaterThan(initialText.length + 80);

      const evidence = await page.evaluate((root) => {
        const state = window as typeof window & {
          __markdownRootEvidence?: {
            addedNodes: number;
            characterDataMutations: number;
            removedNodes: number;
          };
          __markdownRootObserver?: MutationObserver;
        };
        state.__markdownRootObserver?.disconnect();
        const messages = document.querySelectorAll('[data-testid="assistant-message"]');
        const message = messages.item(messages.length - 1);
        const block = message?.lastElementChild;
        return {
          ...state.__markdownRootEvidence,
          connected: root.isConnected,
          sameRoot: block?.firstElementChild === root,
        };
      }, markdownRoot);

      await testInfo.attach("markdown-root-stability", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      expect(evidence.connected).toBe(true);
      expect(evidence.sameRoot).toBe(true);
      expect(
        evidence.removedNodes,
        `Streaming Markdown replaced mounted descendants: ${JSON.stringify(evidence)}`,
      ).toBe(0);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps the viewport fixed after the user scrolls away during a stream", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "stream-scroll-away-",
      title: "Scroll-away anchor",
      model: "five-minute-stream",
      initialPrompt: "emit 120 agent stream updates for scroll-away setup.",
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await openAgentRoute(page, {
        workspaceId: agent.workspaceId,
        agentId: agent.agentId,
      });
      await expectComposerVisible(page);
      await agent.client.sendAgentMessage(agent.agentId, "Stream for scroll-away anchor test.");
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
        timeout: 30_000,
      });
      await awaitAssistantMessage(page);
      await waitForScrollableChat(page, {
        minScrollableDistance: SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE,
        timeout: 30_000,
      });
      const baseline = await scrollChatAwayFromBottom(page, {
        deltaY: -900,
        minDistanceFromBottom: 300,
      });
      await expectScrollStaysFixed(page, baseline, { durationMs: 30_000 });

      const finalMetrics = await readScrollMetrics(page);
      expect(finalMetrics.contentHeight).toBeGreaterThan(baseline.contentHeight);
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps the viewport fixed when delayed authoritative history arrives after scroll-away", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(180_000);
    const timelineGate = await delayCreatedAgentInitialTailResponse(page);
    const workspace = await withWorkspace({
      prefix: "stream-scroll-away-delayed-history-",
    });
    await workspace.navigateTo();
    await clickNewChat(page);
    await page.getByText("Model defaults are still loading").waitFor({
      state: "hidden",
      timeout: 30_000,
    });
    await expectComposerVisible(page);
    await selectModel(page, "Five minute stream");

    const prompt = "Stream for delayed authoritative history scroll-away test.";
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(prompt, { exact: true }).first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await timelineGate.waitForCreatedAgent();
    await timelineGate.waitForDelayedResponse();
    await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await awaitAssistantMessage(page);
    await waitForScrollableChat(page, {
      minScrollableDistance: SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE,
      timeout: 45_000,
    });
    const baseline = await scrollChatAwayFromBottom(page, {
      deltaY: -900,
      minDistanceFromBottom: 300,
    });

    timelineGate.release();
    await timelineGate.waitForForwardedResponse();
    await expectScrollStaysFixed(page, baseline);
  });

  test("places stream controls beside the composer and collapses expanded tool calls", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      Object.assign(globalThis, {
        __BYSPACE_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD: 1,
        __BYSPACE_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS: 4,
      });
      const key = "@byspace:app-settings";
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...stored, autoExpandReasoning: true }));
    });
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "stream-side-controls-",
      title: "Stream side controls",
      model: "ten-second-stream",
      initialPrompt: "Stream enough content to exercise the stream controls.",
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 30_000);
      for (let turn = 0; turn < 3; turn += 1) {
        await agent.client.sendAgentMessage(
          agent.agentId,
          `emit 1 coalesced agent stream updates ${turn}`,
        );
        await agent.client.waitForFinish(agent.agentId, 30_000);
      }
      await openAgentRoute(page, {
        workspaceId: agent.workspaceId,
        agentId: agent.agentId,
      });
      await waitForScrollableChat(page, {
        minScrollableDistance: SCROLL_AWAY_MIN_SCROLLABLE_DISTANCE,
        timeout: 30_000,
      });
      await scrollChatAwayFromBottom(page, {
        deltaY: -900,
        minDistanceFromBottom: 300,
      });

      const composer = page.getByTestId("message-input-root");
      const controls = page.getByTestId("agent-stream-controls");
      const scrollToBottomButton = page.getByRole("button", { name: "Scroll to bottom" });
      await expect(controls).toBeVisible();
      await expect(scrollToBottomButton).toBeVisible();

      const [composerBounds, controlsBounds] = await Promise.all([
        composer.boundingBox(),
        controls.boundingBox(),
      ]);
      expect(composerBounds).not.toBeNull();
      expect(controlsBounds).not.toBeNull();
      expect(controlsBounds!.x).toBeGreaterThanOrEqual(composerBounds!.x + composerBounds!.width);
      expect(controlsBounds!.y).toBeLessThan(composerBounds!.y + composerBounds!.height);
      expect(controlsBounds!.y + controlsBounds!.height).toBeGreaterThan(composerBounds!.y);

      const chatScroll = page.getByTestId("agent-chat-scroll");
      await chatScroll.evaluate((scroll) => {
        scroll.scrollTop = 0;
      });
      const reasoningButtons = page
        .getByTestId("tool-call-badge")
        .filter({ hasText: "Thinking" })
        .getByRole("button");
      const firstReasoning = reasoningButtons.first();
      await expect(firstReasoning).toHaveAttribute("aria-expanded", "true");

      const toolCalls = page
        .getByTestId("tool-call-badge")
        .filter({ hasNotText: "Thinking" })
        .getByRole("button");
      await expect.poll(() => toolCalls.count()).toBeGreaterThan(0);
      const firstToolCall = toolCalls.nth(0);
      await firstToolCall.click();
      await expect(firstToolCall).toHaveAttribute("aria-expanded", "true");

      await page.getByRole("button", { name: "Collapse all tool calls" }).click();
      await expect(firstToolCall).toHaveAttribute("aria-expanded", "false");
      await expect(firstReasoning).toHaveAttribute("aria-expanded", "false");
      const firstReasoningHandle = await firstReasoning.elementHandle();
      if (!firstReasoningHandle) {
        throw new Error("Expected the first reasoning row to be mounted");
      }

      await chatScroll.evaluate((scroll) => {
        scroll.scrollTop = scroll.scrollHeight;
      });
      await expect.poll(() => isElementConnected(firstReasoningHandle)).toBe(false);
      await chatScroll.evaluate((scroll) => {
        scroll.scrollTop = 0;
      });
      await expect(reasoningButtons.first()).toHaveAttribute("aria-expanded", "false");

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(chatScroll).toBeVisible();
      await scrollChatAwayFromBottom(page, {
        deltaY: -500,
        minDistanceFromBottom: 200,
      });
      const [compactComposerBounds, compactControlsBounds] = await Promise.all([
        composer.boundingBox(),
        controls.boundingBox(),
      ]);
      expect(compactComposerBounds).not.toBeNull();
      expect(compactControlsBounds).not.toBeNull();
      expect(compactControlsBounds!.x).toBeGreaterThanOrEqual(
        compactComposerBounds!.x + compactComposerBounds!.width,
      );
      expect(compactControlsBounds!.x + compactControlsBounds!.width).toBeLessThanOrEqual(390);
      expect(compactComposerBounds!.width).toBeGreaterThan(240);

      await scrollToBottomButton.click();
      await expectNearBottom(page);
      await expect(scrollToBottomButton).toBeHidden();

      await page.setViewportSize({ width: 1280, height: 720 });
      await agent.client.archiveAgent(agent.agentId);
      await openSessions(page);
      await expectSessionRowArchived(page, "Stream side controls");
      await clickSessionRow(page, "Stream side controls");
      await expectArchivedAgentFocused(page, agent.agentId);
      await chatScroll.evaluate((scroll) => {
        const spacer = document.createElement("div");
        spacer.style.height = "2000px";
        spacer.style.flexShrink = "0";
        scroll.append(spacer);
        scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect(controls).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("working-indicator transitions to copy-button when stream ends", async ({ page }) => {
    test.setTimeout(60_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "stream-indicator-",
      model: "ten-second-stream",
      prompt: "Stream briefly for indicator transition test.",
    });
    try {
      await awaitAssistantMessage(page);
      await expectInlineWorkingIndicator(page);
      await expectAgentIdle(page, 30_000);
      await scrollAgentChatToBottom(page);
      await expectTurnCopyButton(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("shows elapsed timer on first app-created running turn", async ({ page, withWorkspace }) => {
    test.setTimeout(90_000);
    const workspace = await withWorkspace({ prefix: "stream-first-app-turn-timer-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await page.getByText("Model defaults are still loading").waitFor({
      state: "hidden",
      timeout: 30_000,
    });
    const prompt = "Stream briefly for first app-created turn timer test.";
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(prompt, { exact: true }).first().waitFor({ state: "visible" });
    await awaitAssistantMessage(page);
    await expectInlineWorkingIndicator(page);
    await page.getByTestId("turn-working-elapsed").waitFor({ state: "visible", timeout: 5_000 });
  });
});
