import { expect, test } from "./fixtures";
import {
  expectLoadedTimelineDoesNotScroll,
  expectTimelinePromptNotMounted,
  expectTimelinePromptVisible,
  holdNextOlderTimelinePage,
  makeLoadedTimelineFitViewport,
  openAgentTimeline,
  scrollTimelineUntilPromptIsVisible,
  seedLongMockAgentTimeline,
  waitForPersistedCanonicalTimelineRange,
} from "./helpers/timeline-pagination";
import { trackAgentTimelineRequests } from "./helpers/agent-timeline-gate";
import { seedMockAgentWorkspace } from "./helpers/mock-agent";

test.describe("Agent timeline pagination", () => {
  test("resumes a persisted canonical timeline after its exact end", async ({ page }) => {
    const prompt = "timeline persisted range resumes without tail replay";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "timeline-persisted-range-",
      title: "Persisted timeline range",
      initialPrompt: prompt,
    });
    try {
      await agent.client.waitForFinish(agent.agentId, 15_000);
      await openAgentTimeline(page, agent);
      await expectTimelinePromptVisible(page, prompt);
      const range = await waitForPersistedCanonicalTimelineRange(page, agent.agentId);

      const tracker = await trackAgentTimelineRequests(page, agent.agentId);
      await page.reload();
      await expectTimelinePromptVisible(page, prompt);

      const request = await tracker.nextRequest();
      expect(request).toEqual({
        direction: "after",
        cursor: { epoch: range.epoch, seq: range.endSeq },
      });
      await tracker.waitForResponse();
      expect(tracker.requests().some((entry) => entry.direction === "tail")).toBe(false);
    } finally {
      await agent.cleanup();
    }
  });

  test("loads older history when the user scrolls to the top of a long agent timeline", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await seedLongMockAgentTimeline({ turns: 80 });
    try {
      await openAgentTimeline(page, agent);
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await expectTimelinePromptNotMounted(page, agent.oldestPrompt);

      await scrollTimelineUntilPromptIsVisible(page, agent.oldestPrompt);

      await expectTimelinePromptVisible(page, agent.oldestPrompt);
    } finally {
      await agent.cleanup();
    }
  });

  test("loads older history when the initial page does not fill the viewport", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await seedLongMockAgentTimeline({ turns: 30 });
    try {
      await makeLoadedTimelineFitViewport(page);
      const olderPage = await holdNextOlderTimelinePage(page, agent);
      await openAgentTimeline(page, agent);
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await expectLoadedTimelineDoesNotScroll(page);
      await olderPage.expectLoading();
      olderPage.release();
      await expectTimelinePromptVisible(page, agent.oldestPrompt);
    } finally {
      await agent.cleanup();
    }
  });
});
