import { expect, type ElementHandle, type Page } from "@playwright/test";

const NEAR_BOTTOM_THRESHOLD_PX = 72;
const DEFAULT_SCROLL_TOLERANCE_PX = 24;

export interface ScrollMetrics {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
  distanceFromBottom: number;
}

interface ScrollAnchorBaseline extends ScrollMetrics {
  anchor: ElementHandle<HTMLElement>;
  anchorTop: number;
}

function getVisibleChatScroll(page: Page) {
  return page.locator('[data-testid="agent-chat-scroll"]:visible').first();
}

export async function readScrollMetrics(page: Page): Promise<ScrollMetrics> {
  return getVisibleChatScroll(page).evaluate((root: Element) => {
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
      )[0] ?? (root as HTMLElement);

    const offsetY = Math.max(0, scrollElement.scrollTop);
    const contentHeight = Math.max(0, scrollElement.scrollHeight);
    const viewportHeight = Math.max(0, scrollElement.clientHeight);
    const distanceFromBottom = Math.max(0, contentHeight - (offsetY + viewportHeight));

    return {
      offsetY,
      contentHeight,
      viewportHeight,
      distanceFromBottom,
    };
  });
}

export async function expectNearBottom(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const metrics = await readScrollMetrics(page);
      return metrics.distanceFromBottom;
    })
    .toBeLessThanOrEqual(NEAR_BOTTOM_THRESHOLD_PX);
}

export async function scrollAgentChatToBottom(page: Page): Promise<void> {
  const chatScroll = getVisibleChatScroll(page);
  await chatScroll.evaluate((root: Element) => {
    const scrollElement = root as HTMLElement;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  });
  await expect
    .poll(async () =>
      chatScroll.evaluate((root: Element) => {
        const scrollElement = root as HTMLElement;
        return Math.max(
          0,
          scrollElement.scrollHeight - (scrollElement.scrollTop + scrollElement.clientHeight),
        );
      }),
    )
    .toBeLessThanOrEqual(NEAR_BOTTOM_THRESHOLD_PX);
}

export async function waitForContentGrowth(
  page: Page,
  previousContentHeight: number,
): Promise<ScrollMetrics> {
  await expect
    .poll(async () => {
      const metrics = await readScrollMetrics(page);
      return metrics.contentHeight;
    })
    .toBeGreaterThan(previousContentHeight);
  return readScrollMetrics(page);
}

export async function waitForScrollableChat(
  page: Page,
  input: { minScrollableDistance: number; timeout?: number },
): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await readScrollMetrics(page);
        return metrics.contentHeight - metrics.viewportHeight;
      },
      { timeout: input.timeout },
    )
    .toBeGreaterThan(input.minScrollableDistance);
}

export async function scrollChatAwayFromBottom(
  page: Page,
  input: { deltaY: number; minDistanceFromBottom: number },
): Promise<ScrollAnchorBaseline> {
  const scroll = getVisibleChatScroll(page);
  // Keep the gesture on the chat viewport so nested tool scrollers cannot consume it.
  await scroll.evaluate((root: Element, deltaY) => {
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY }));
    const scrollElement = root as HTMLElement;
    scrollElement.scrollTop += deltaY;
  }, input.deltaY);

  await expect
    .poll(async () => {
      const metrics = await readScrollMetrics(page);
      return metrics.distanceFromBottom;
    })
    .toBeGreaterThan(input.minDistanceFromBottom);

  const anchorHandle = await scroll.evaluateHandle((root) => {
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[data-testid="user-message"], [data-testid="assistant-message"]',
      ),
    );
    const liveAssistant = rows.findLast((row) => row.dataset.testid === "assistant-message");
    const viewport = root.getBoundingClientRect();
    return (
      rows.find((row) => {
        if (row === liveAssistant) return false;
        const bounds = row.getBoundingClientRect();
        return bounds.height > 0 && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
      }) ?? null
    );
  });
  const anchor = anchorHandle.asElement() as ElementHandle<HTMLElement> | null;
  if (!anchor) {
    await anchorHandle.dispose();
    throw new Error("Expected a stable visible history row after scrolling away");
  }

  return {
    ...(await readScrollMetrics(page)),
    anchor,
    anchorTop: await anchor.evaluate((row) => row.getBoundingClientRect().top),
  };
}

export async function expectScrollStaysFixed(
  page: Page,
  baseline: ScrollAnchorBaseline,
  input?: { durationMs?: number; sampleIntervalMs?: number; tolerancePx?: number },
): Promise<void> {
  const durationMs = input?.durationMs ?? 2_000;
  const sampleIntervalMs = input?.sampleIntervalMs ?? 250;
  const tolerancePx = input?.tolerancePx ?? DEFAULT_SCROLL_TOLERANCE_PX;
  const samples: Array<{ elapsedMs: number; anchorTop: number; contentHeight: number }> = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await page.waitForTimeout(sampleIntervalMs);
    const [anchorState, metrics] = await Promise.all([
      baseline.anchor.evaluate((row) => ({
        connected: row.isConnected,
        top: row.getBoundingClientRect().top,
      })),
      readScrollMetrics(page),
    ]);
    samples.push({
      elapsedMs: Date.now() - startedAt,
      anchorTop: anchorState.top,
      contentHeight: metrics.contentHeight,
    });
    expect(
      anchorState.connected && Math.abs(anchorState.top - baseline.anchorTop) <= tolerancePx,
      JSON.stringify({
        baseline: { ...baseline, anchor: undefined },
        samples: samples.slice(-12),
      }),
    ).toBe(true);
  }
}
