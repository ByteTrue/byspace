import { expect, type Page } from "@playwright/test";
import { buildAgentRoute, seedMockAgentWorkspace, type MockAgentWorkspace } from "./mock-agent";
import { readReplicaCache } from "./replica-cache-storage";
import {
  delayAgentOlderTimelineResponse,
  type AgentTimelineResponseGate,
} from "./agent-timeline-gate";

interface LongTimelineAgentOptions {
  turns: number;
}

export interface LongTimelineAgent extends MockAgentWorkspace {
  prompts: string[];
  firstOlderPagePrompt: string;
  initialTailAnchorPrompt: string;
  initialTailOldestPrompt: string;
  oldestPrompt: string;
  newestPrompt: string;
}

const PROMPT_PREFIX = "timeline-pagination-turn";
const HISTORY_START_THRESHOLD_PX = 96;

interface TimelineViewportSnapshot {
  scrollHeight: number;
  scrollTop: number;
}

interface PersistedCanonicalTimelineRange {
  epoch: string;
  startSeq: number;
  endSeq: number;
}

interface TimelinePromptPositionSnapshot {
  prompt: string;
  top: number;
}

export interface TimelinePresentationSnapshot {
  marker: string;
  position: TimelinePromptPositionSnapshot;
  viewport: TimelineViewportSnapshot;
}

function promptForTurn(index: number): string {
  return `${PROMPT_PREFIX}-${index}: emit 1 coalesced agent stream updates`;
}

export async function seedLongMockAgentTimeline(
  options: LongTimelineAgentOptions,
): Promise<LongTimelineAgent> {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "timeline-pagination-",
    title: "Timeline pagination regression",
    model: "ten-second-stream",
  });

  for (let index = 0; index < options.turns; index += 1) {
    await agent.client.sendAgentMessage(agent.agentId, promptForTurn(index));
    await agent.client.waitForFinish(agent.agentId, 15_000);
  }

  return {
    ...agent,
    prompts: Array.from({ length: options.turns }, (_unused, index) => promptForTurn(index)),
    firstOlderPagePrompt: promptForTurn(Math.max(0, options.turns - 40)),
    initialTailAnchorPrompt: promptForTurn(Math.max(0, options.turns - 5)),
    initialTailOldestPrompt: promptForTurn(Math.max(0, options.turns - 20)),
    oldestPrompt: promptForTurn(0),
    newestPrompt: promptForTurn(options.turns - 1),
  };
}

export async function openAgentTimeline(
  page: Page,
  agent: LongTimelineAgent | MockAgentWorkspace,
): Promise<void> {
  await page.goto(buildAgentRoute(agent.workspaceId, agent.agentId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
}

export async function expectTimelinePromptVisible(page: Page, prompt: string): Promise<void> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  await expect(timeline.getByText(prompt, { exact: true })).toBeVisible({ timeout: 30_000 });
}

export async function expectTimelinePromptNotMounted(page: Page, prompt: string): Promise<void> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  await expect(timeline.getByText(prompt, { exact: true })).toHaveCount(0);
}

export async function makeLoadedTimelineFitViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 20_000 });
}

export async function expectLoadedTimelineDoesNotScroll(page: Page): Promise<void> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  await expect
    .poll(async () =>
      scroll.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error("Agent chat scroll element is not an HTMLElement");
        }
        return element.scrollHeight <= element.clientHeight;
      }),
    )
    .toBe(true);
}

export async function reloadAgentTimelineFromPersistedReplica(
  page: Page,
  agent: LongTimelineAgent,
): Promise<void> {
  await expect
    .poll(async () => {
      const cache = await readReplicaCache(page);
      const timeline = cache?.hosts?.find(
        (host) => host.timeline?.agentId === agent.agentId,
      )?.timeline;
      return timeline?.items?.length === 50;
    })
    .toBe(true);

  await page.reload();
  await expectTimelinePromptVisible(page, agent.newestPrompt);
}

export async function waitForPersistedCanonicalTimelineRange(
  page: Page,
  agentId: string,
): Promise<PersistedCanonicalTimelineRange> {
  const readRange = async () => {
    const cache = await readReplicaCache(page);
    if (cache?.version !== 6) return null;
    const range = cache.hosts?.find((host) => host.timeline?.agentId === agentId)?.timeline?.range;
    if (
      typeof range?.epoch !== "string" ||
      typeof range.startSeq !== "number" ||
      typeof range.endSeq !== "number"
    ) {
      return null;
    }
    return { epoch: range.epoch, startSeq: range.startSeq, endSeq: range.endSeq };
  };

  await expect.poll(readRange).not.toBeNull();
  const range = await readRange();
  if (!range) {
    throw new Error(`Persisted canonical timeline range is missing for ${agentId}`);
  }
  return range;
}

export async function holdNextOlderTimelinePage(
  page: Page,
  agent: LongTimelineAgent,
): Promise<AgentTimelineResponseGate & { expectLoading(): Promise<void> }> {
  const gate = await delayAgentOlderTimelineResponse(page, agent.agentId);
  return {
    ...gate,
    async expectLoading() {
      await gate.waitForDelayedResponse();
      await expect(page.getByTestId("load-older-history-spinner")).toBeVisible();
      await expectTimelinePromptNotMounted(page, agent.oldestPrompt);
    },
  };
}

export async function scrollTimelineToOldestLoadedEdge(page: Page): Promise<void> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  await scroll.hover();
  await page.mouse.wheel(0, -20_000);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await scroll.evaluate((root) => {
    if (!(root instanceof HTMLElement)) {
      throw new Error("Agent chat scroll element is not an HTMLElement");
    }
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .filter((element) => {
        const tagName = element.tagName.toLowerCase();
        const isEditable =
          tagName === "textarea" ||
          tagName === "input" ||
          element.getAttribute("contenteditable") === "true";
        return !isEditable && element.scrollHeight - element.clientHeight > 1;
      });
    const scrollElement =
      candidates.sort(
        (left, right) =>
          right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight),
      )[0] ?? root;
    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

export async function scrollTimelineUntilPromptIsVisible(
  page: Page,
  prompt: string,
): Promise<void> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const target = page.getByText(prompt, { exact: true });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await target.isVisible()) {
      return;
    }
    const previousHeight = await scroll.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error("Agent chat scroll element is not an HTMLElement");
      }
      return element.scrollHeight;
    });
    await scrollTimelineToOldestLoadedEdge(page);
    await expect
      .poll(async () => {
        if (await target.isVisible()) {
          return true;
        }
        return scroll.evaluate((element, height) => {
          if (!(element instanceof HTMLElement)) {
            throw new Error("Agent chat scroll element is not an HTMLElement");
          }
          return element.scrollHeight > height;
        }, previousHeight);
      })
      .toBe(true);
  }

  await expect(target).toBeVisible();
}

async function readTimelineViewport(page: Page): Promise<TimelineViewportSnapshot> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  return scroll.evaluate((root) => {
    if (!(root instanceof HTMLElement)) {
      throw new Error("Agent chat scroll element is not an HTMLElement");
    }
    let element: HTMLElement | null = root;
    while (element) {
      const overflowY = window.getComputedStyle(element).overflowY;
      if (element.scrollHeight > element.clientHeight + 1 && overflowY !== "visible") {
        return { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
      }
      element = element.parentElement;
    }
    return { scrollHeight: root.scrollHeight, scrollTop: root.scrollTop };
  });
}

export async function rememberTimelinePromptPosition(
  page: Page,
  prompt: string,
): Promise<TimelinePromptPositionSnapshot> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const item = timeline.getByText(prompt, { exact: true });
  await expect(item).toBeVisible();
  const box = await item.boundingBox();
  if (!box) {
    throw new Error(`Expected a rendered timeline item for ${prompt}`);
  }
  return { prompt, top: box.y };
}

export async function expectTimelinePromptPositionPreserved(
  page: Page,
  before: TimelinePromptPositionSnapshot,
): Promise<void> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const item = timeline.getByText(before.prompt, { exact: true });
  await expect(item).toBeVisible();
  await expect
    .poll(async () => {
      const box = await item.boundingBox();
      return box ? Math.abs(box.y - before.top) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(2);
}

export async function rememberTimelineViewport(page: Page): Promise<TimelineViewportSnapshot> {
  return readTimelineViewport(page);
}

export async function scrollTimelinePromptIntoView(page: Page, prompt: string): Promise<void> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const row = timeline.getByTestId("user-message").filter({ hasText: prompt });
  await row.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await expect(row).toBeVisible();
  await expect
    .poll(async () => (await readTimelineViewport(page)).scrollTop)
    .toBeGreaterThan(HISTORY_START_THRESHOLD_PX);
}

export async function rememberTimelinePresentation(
  page: Page,
  prompt: string,
): Promise<TimelinePresentationSnapshot> {
  const timeline = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const row = timeline.getByTestId("user-message").filter({ hasText: prompt });
  await expect(row).toBeVisible();
  const marker = `timeline-presentation-${Date.now()}`;
  await row.evaluate((element, value) => {
    element.dataset.timelinePresentation = value;
  }, marker);
  return {
    marker,
    position: await rememberTimelinePromptPosition(page, prompt),
    viewport: await rememberTimelineViewport(page),
  };
}

export async function expectTimelinePresentationUnchanged(
  page: Page,
  before: TimelinePresentationSnapshot,
): Promise<void> {
  await expect(page.locator(`[data-timeline-presentation="${before.marker}"]`)).toBeVisible();
  await expectTimelinePromptPositionPreserved(page, before.position);
  await expect.poll(async () => rememberTimelineViewport(page)).toEqual(before.viewport);
}

export async function userScrollsTimelineToHistoryStart(page: Page): Promise<void> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  await scroll.hover();
  for (let step = 0; step < 60; step += 1) {
    if ((await readTimelineViewport(page)).scrollTop <= HISTORY_START_THRESHOLD_PX) {
      break;
    }
    await page.mouse.wheel(0, -1_000);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        }),
    );
  }
  await expect
    .poll(async () => (await readTimelineViewport(page)).scrollTop)
    .toBeLessThanOrEqual(HISTORY_START_THRESHOLD_PX);
}

async function waitForTimelineGeometryToSettle(page: Page): Promise<void> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  await scroll.evaluate(
    (root) =>
      new Promise<void>((resolve, reject) => {
        if (!(root instanceof HTMLElement)) {
          reject(new Error("Agent chat scroll element is not an HTMLElement"));
          return;
        }
        const element =
          [root, ...Array.from(root.querySelectorAll("*"))].find(
            (candidate): candidate is HTMLElement => {
              if (!(candidate instanceof HTMLElement)) return false;
              const tagName = candidate.tagName.toLowerCase();
              const isEditable =
                tagName === "textarea" ||
                tagName === "input" ||
                candidate.getAttribute("contenteditable") === "true";
              if (isEditable) return false;
              const style = window.getComputedStyle(candidate);
              const isScrollableOverflow =
                style.overflowY === "auto" || style.overflowY === "scroll";
              return (
                isScrollableOverflow &&
                candidate.clientHeight > 0 &&
                candidate.scrollHeight - candidate.clientHeight > 1
              );
            },
          ) ?? root;
        const startedAt = performance.now();
        let stableFrames = 0;
        let previous = `${element.scrollTop}:${element.scrollHeight}`;
        const sample = () => {
          const current = `${element.scrollTop}:${element.scrollHeight}`;
          stableFrames = current === previous ? stableFrames + 1 : 0;
          previous = current;
          if (stableFrames >= 4) {
            resolve();
            return;
          }
          if (performance.now() - startedAt > 5_000) {
            reject(new Error("Timeline geometry did not settle"));
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
}

export async function scrollTimelineUntilOlderHistoryIsReachable(
  page: Page,
  oldestPrompt: string,
): Promise<void> {
  const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
  const prompt = scroll.getByText(oldestPrompt, { exact: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await prompt.count()) > 0) {
      await expect(prompt).toBeVisible();
      return;
    }
    const previousHeight = await readTimelineViewport(page);
    await userScrollsTimelineToHistoryStart(page);
    await expect
      .poll(async () => (await readTimelineViewport(page)).scrollHeight)
      .toBeGreaterThan(previousHeight.scrollHeight);
    await waitForTimelineGeometryToSettle(page);
  }
  await expect(prompt).toBeVisible();
}
