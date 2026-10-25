import { expect, type Locator, type Page } from "@playwright/test";

const NEAR_BOTTOM_THRESHOLD_PX = 72;
const DEFAULT_SCROLL_TOLERANCE_PX = 24;

export interface ScrollMetrics {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
  distanceFromBottom: number;
}

function getVisibleChatScroll(page: Page) {
  return page.locator('[data-testid="agent-chat-scroll"]:visible').first();
}

interface PositionedToolCall {
  locator: Locator;
  bounds: { x: number; y: number; width: number; height: number };
}

async function readRenderedToolCalls(toolCalls: Locator): Promise<PositionedToolCall[]> {
  const entries = await Promise.all(
    Array.from({ length: await toolCalls.count() }, async (_, index) => ({
      locator: toolCalls.nth(index),
      bounds: await toolCalls.nth(index).boundingBox(),
    })),
  );
  return entries.filter(
    (entry): entry is PositionedToolCall => entry.bounds !== null && entry.bounds.width > 0,
  );
}

function closestToolCallToY(toolCalls: PositionedToolCall[], targetY: number) {
  return toolCalls.toSorted(
    (left, right) =>
      Math.abs(left.bounds.y + left.bounds.height / 2 - targetY) -
      Math.abs(right.bounds.y + right.bounds.height / 2 - targetY),
  )[0];
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

const WHEEL_SETTLE_TIMEOUT_MS = 5_000;

export async function scrollChatAwayFromBottom(
  page: Page,
  input: { deltaY: number; minDistanceFromBottom: number },
): Promise<ScrollMetrics> {
  const scroll = getVisibleChatScroll(page);
  const box = await scroll.boundingBox();
  if (!box) {
    throw new Error("Agent chat scroll container is not visible");
  }
  // Letting the scroll animation stop before measuring is an optimization, so it must never be
  // the thing that decides the test — the assertion below is. The old wait could not say that:
  // it resolved only from a `requestAnimationFrame` sampler started by a `wheel` listener, and
  // rAF does not fire at all while the page is occluded, which is reachable on a CI runner and
  // stalls the sampler on its first frame. A missed wheel event did the same. Either way the
  // test hung until its own timeout with nothing to read. A timed sampler with a deadline
  // cannot: worst case it gives up and the poll below reports what the scroll actually did.
  const wheelSettled = scroll.evaluate((root: Element, timeoutMs: number) => {
    const scrollElement = root as HTMLElement;
    return new Promise<void>((resolve) => {
      const startedAt = Date.now();
      let sawWheel = false;
      let previousOffset = scrollElement.scrollTop;
      let stableSamples = 0;
      root.addEventListener(
        "wheel",
        () => {
          sawWheel = true;
        },
        { once: true },
      );
      const sample = () => {
        const currentOffset = scrollElement.scrollTop;
        const isStable = sawWheel && Math.abs(currentOffset - previousOffset) <= 0.5;
        stableSamples = isStable ? stableSamples + 1 : 0;
        previousOffset = currentOffset;
        if (stableSamples >= 3 || Date.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(sample, 16);
      };
      sample();
    });
  }, WHEEL_SETTLE_TIMEOUT_MS);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, input.deltaY);
  await wheelSettled;

  await expect
    .poll(async () => {
      const metrics = await readScrollMetrics(page);
      return metrics.distanceFromBottom;
    })
    .toBeGreaterThan(input.minDistanceFromBottom);

  return readScrollMetrics(page);
}

export async function clickToolCallBesideScrollToBottomButton(page: Page): Promise<{
  outsideButton: boolean;
  toolCallReceivesPointer: boolean;
  withinButtonBand: boolean;
}> {
  await scrollChatAwayFromBottom(page, {
    deltaY: -900,
    minDistanceFromBottom: 300,
  });

  const scrollToBottomButton = page.getByRole("button", { name: "Scroll to bottom" });
  await expect(scrollToBottomButton).toBeVisible();

  const buttonBounds = await scrollToBottomButton.boundingBox();
  expect(buttonBounds, "Expected visible scroll-to-bottom button bounds").not.toBeNull();
  const visibleButtonBounds = buttonBounds!;

  const toolCalls = page.locator('[data-testid="tool-call-badge"] [role="button"]');
  const buttonCenterY = visibleButtonBounds.y + visibleButtonBounds.height / 2;
  const initialToolCalls = await readRenderedToolCalls(toolCalls);
  const initialCandidate = closestToolCallToY(initialToolCalls, buttonCenterY);
  expect(
    initialCandidate,
    `Expected at least one rendered tool-call badge: ${JSON.stringify({
      buttonBounds,
      scrollMetrics: await readScrollMetrics(page),
      toolCallBounds: initialToolCalls.map(({ bounds }) => bounds),
    })}`,
  ).toBeDefined();
  await expect
    .poll(async () => {
      const currentButtonBounds = await scrollToBottomButton.boundingBox();
      if (!currentButtonBounds) return false;
      const currentButtonCenterY = currentButtonBounds.y + currentButtonBounds.height / 2;
      const closest = closestToolCallToY(
        await readRenderedToolCalls(toolCalls),
        currentButtonCenterY,
      );
      if (!closest) return false;
      const toolCallCenterY = closest.bounds.y + closest.bounds.height / 2;
      if (
        toolCallCenterY >= currentButtonBounds.y &&
        toolCallCenterY <= currentButtonBounds.y + currentButtonBounds.height
      ) {
        return true;
      }
      const deltaY = Math.max(-200, Math.min(200, toolCallCenterY - currentButtonCenterY));
      await getVisibleChatScroll(page).evaluate((scroll, delta) => {
        (scroll as HTMLElement).scrollTop += delta;
      }, deltaY);
      return false;
    })
    .toBe(true);

  const currentButtonBounds = await scrollToBottomButton.boundingBox();
  expect(currentButtonBounds, "Expected scroll-to-bottom button to remain visible").not.toBeNull();
  const currentButtonCenterY = currentButtonBounds!.y + currentButtonBounds!.height / 2;
  const alignedToolCall = closestToolCallToY(
    await readRenderedToolCalls(toolCalls),
    currentButtonCenterY,
  )?.locator;
  expect(alignedToolCall, "Expected an aligned tool-call badge").toBeDefined();
  const [alignedButtonBounds, visibleToolCallBounds] = await Promise.all([
    scrollToBottomButton.boundingBox(),
    alignedToolCall!.boundingBox(),
  ]);
  expect(alignedButtonBounds, "Expected scroll-to-bottom button to remain visible").not.toBeNull();
  expect(
    visibleToolCallBounds,
    "Expected aligned tool-call badge to remain visible",
  ).not.toBeNull();
  const finalButtonBounds = alignedButtonBounds!;
  const finalToolCallBounds = visibleToolCallBounds!;

  const clickPoint = {
    x: finalToolCallBounds.x + 24,
    y: finalToolCallBounds.y + finalToolCallBounds.height / 2,
  };
  const toolCallReceivesPointer = await alignedToolCall!.evaluate((toolCall, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return hit !== null && toolCall.contains(hit);
  }, clickPoint);
  const hitArea = {
    clickPoint,
    outsideButton:
      clickPoint.x < finalButtonBounds.x ||
      clickPoint.x > finalButtonBounds.x + finalButtonBounds.width,
    toolCallReceivesPointer,
    withinButtonBand:
      clickPoint.y >= finalButtonBounds.y &&
      clickPoint.y <= finalButtonBounds.y + finalButtonBounds.height,
  };
  await page.mouse.click(hitArea.clickPoint.x, hitArea.clickPoint.y);
  return {
    outsideButton: hitArea.outsideButton,
    toolCallReceivesPointer: hitArea.toolCallReceivesPointer,
    withinButtonBand: hitArea.withinButtonBand,
  };
}

// A reader who left the bottom is anchored to what they are reading, not to scrollTop. Rows
// above the reading position can change height for reasons the scroll container cannot
// prevent — a reasoning row collapsing when the next assistant response starts, a row
// re-rendered from a canonical echo, the virtualizer mounting a taller row — and the browser's
// own scroll anchoring absorbs that by moving scrollTop. Asserting on scrollTop therefore
// fails whenever content above the reader grows, even though nothing moved in their view.
const READING_ROW_PROBE_OFFSET_PX = 24;

export interface ReadingPosition {
  rowId: string;
  viewportOffset: number;
}

/**
 * Reads the row rendered at the top of the scroll viewport — the line the reader is looking at.
 * Returns null when the scroll box has no positioned history row to anchor to.
 */
export async function readReadingPosition(page: Page): Promise<ReadingPosition | null> {
  return getVisibleChatScroll(page).evaluate((root: Element, probeOffset: number) => {
    const scrollElement = root as HTMLElement;
    const scrollBounds = scrollElement.getBoundingClientRect();
    const probeY = scrollBounds.top + probeOffset;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-history-row-id]"))
      .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
      .filter((row) => row.bounds.height > 0)
      .toSorted((left, right) => left.bounds.top - right.bounds.top);
    const anchor =
      rows.find((row) => row.bounds.top <= probeY && row.bounds.bottom > probeY) ??
      rows.find((row) => row.bounds.top >= probeY) ??
      null;
    if (!anchor) {
      return null;
    }
    return {
      rowId: anchor.element.dataset.historyRowId ?? "",
      viewportOffset: anchor.bounds.top - scrollBounds.top,
    };
  }, READING_ROW_PROBE_OFFSET_PX);
}

/** Distance from the top of the scroll viewport to the top of one rendered row, or null. */
async function readRowViewportOffset(page: Page, rowId: string): Promise<number | null> {
  return getVisibleChatScroll(page).evaluate((root: Element, id: string) => {
    const scrollElement = root as HTMLElement;
    const row = Array.from(root.querySelectorAll<HTMLElement>("[data-history-row-id]")).find(
      (element) => element.dataset.historyRowId === id,
    );
    if (!row) {
      return null;
    }
    const bounds = row.getBoundingClientRect();
    return bounds.height > 0 ? bounds.top - scrollElement.getBoundingClientRect().top : null;
  }, rowId);
}

/**
 * Scrolls away from the bottom and records the reading position, so
 * {@link expectReadingPositionStaysFixed} can assert the reader's view did not move.
 */
export async function scrollChatAwayFromBottomAndReadPosition(
  page: Page,
  input: { deltaY: number; minDistanceFromBottom: number },
): Promise<{ metrics: ScrollMetrics; reading: ReadingPosition }> {
  const metrics = await scrollChatAwayFromBottom(page, input);
  await expect
    .poll(async () => (await readReadingPosition(page))?.rowId ?? null, { timeout: 5_000 })
    .not.toBeNull();
  const reading = await readReadingPosition(page);
  if (!reading) {
    throw new Error("Agent chat has no rendered history row to anchor the reading position to");
  }
  return { metrics, reading };
}

/**
 * Asserts the row the reader is looking at keeps its place in the viewport while content lands
 * above them. Content height is expected to grow; scrollTop is allowed to move with it.
 */
export async function expectReadingPositionStaysFixed(
  page: Page,
  baseline: ReadingPosition,
  input?: { durationMs?: number; sampleIntervalMs?: number; tolerancePx?: number },
): Promise<void> {
  const durationMs = input?.durationMs ?? 2_000;
  const sampleIntervalMs = input?.sampleIntervalMs ?? 250;
  const tolerancePx = input?.tolerancePx ?? DEFAULT_SCROLL_TOLERANCE_PX;
  const samples: Array<{
    elapsedMs: number;
    viewportOffset: number | null;
    metrics: ScrollMetrics;
  }> = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await page.waitForTimeout(sampleIntervalMs);
    const viewportOffset = await readRowViewportOffset(page, baseline.rowId);
    const metrics = await readScrollMetrics(page);
    samples.push({ elapsedMs: Date.now() - startedAt, viewportOffset, metrics });
    if (viewportOffset === null) {
      throw new Error(
        `The reading row ${baseline.rowId} left the rendered window: ${JSON.stringify({ baseline, samples: samples.slice(-12) })}`,
      );
    }
    expect(
      Math.abs(viewportOffset - baseline.viewportOffset),
      JSON.stringify({ baseline, samples: samples.slice(-12) }),
    ).toBeLessThanOrEqual(tolerancePx);
  }
}

export async function expectScrollStaysFixed(
  page: Page,
  baseline: ScrollMetrics,
  input?: { durationMs?: number; sampleIntervalMs?: number; tolerancePx?: number },
): Promise<void> {
  const durationMs = input?.durationMs ?? 2_000;
  const sampleIntervalMs = input?.sampleIntervalMs ?? 250;
  const tolerancePx = input?.tolerancePx ?? DEFAULT_SCROLL_TOLERANCE_PX;
  const samples: Array<{ elapsedMs: number; offsetY: number; contentHeight: number }> = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await page.waitForTimeout(sampleIntervalMs);
    const metrics = await readScrollMetrics(page);
    samples.push({
      elapsedMs: Date.now() - startedAt,
      offsetY: metrics.offsetY,
      contentHeight: metrics.contentHeight,
    });
    expect(
      metrics.offsetY,
      JSON.stringify({ baseline, samples: samples.slice(-12) }),
    ).toBeLessThanOrEqual(baseline.offsetY + tolerancePx);
  }
}
