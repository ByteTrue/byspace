import { test, expect } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { startRunningMockAgent } from "../support/helpers/composer";
import { openSettingsSection } from "../support/helpers/settings";

const SETTINGS_KEY = "@byspace:app-settings";

interface BadgeState {
  /** Badge label text, e.g. "Thinking" or the tool call summary. */
  label: string;
  /** aria-expanded of the badge's pressable; "" when the row has nothing to open. */
  expanded: string;
}

/**
 * Every expander badge in timeline order. The badge testID sits on the container; the expanded
 * state lives on the inner pressable button.
 */
async function badgeStates(page: import("@playwright/test").Page): Promise<BadgeState[]> {
  return page.getByTestId("tool-call-badge").evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.textContent ?? "",
      expanded: node.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") ?? "",
    })),
  );
}

const isThinkingBadge = (badge: BadgeState) => badge.label.includes("Thinking");

function readStoredTimelineDetailLevel(page: import("@playwright/test").Page): Promise<unknown> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("@byspace:app-settings") ?? "{}").timelineDetailLevel,
  );
}

/**
 * Whether the newest thinking block has folded because something else became the timeline tail.
 * "tail-still-thinking" means no non-thinking row has landed below it yet.
 */
function liveTailState(badges: BadgeState[]): string {
  const tail = badges.at(-1);
  if (!tail || isThinkingBadge(tail)) {
    return "tail-still-thinking";
  }
  const thinkingStates = badges.filter(isThinkingBadge).map((badge) => badge.expanded);
  if (thinkingStates.length === 0) {
    return "no-thinking";
  }
  return thinkingStates.every((state) => state === "false") ? "folded" : "still-expanded";
}

async function thinkingRowStates(page: import("@playwright/test").Page) {
  return (await badgeStates(page)).filter(isThinkingBadge).map((badge) => badge.expanded);
}

/** Expandable tool call rows (everything that is not a thinking block). */
async function toolRowStates(page: import("@playwright/test").Page) {
  return (await badgeStates(page))
    .filter((badge) => !isThinkingBadge(badge) && badge.expanded !== "")
    .map((badge) => badge.expanded);
}

function setTimelineDetailLevel(page: import("@playwright/test").Page, level: string) {
  return page.addInitScript(
    ({ key, value }) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({ ...stored, timelineDetailLevel: value }));
    },
    { key: SETTINGS_KEY, value: level },
  );
}

/** Distance in px between the scroll area's bottom edge and its tail. */
function readTailDistance(node: Element): number {
  const area = node as HTMLElement;
  return area.scrollHeight - (area.scrollTop + area.clientHeight);
}

function readOverflow(node: Element): number {
  const area = node as HTMLElement;
  return area.scrollHeight - area.clientHeight;
}

test.describe("Timeline detail level", () => {
  // The picker is the only place the level is chosen; a missing option or a label that never
  // reaches the trigger would leave the level unreachable however correct the timeline is.
  test("the settings picker offers every level and applies the choice", async ({ page }) => {
    await page.goto("/settings");
    await openSettingsSection(page, "appearance");

    const trigger = page.getByLabel(/^Select timeline detail/);
    await expect(trigger).toBeVisible();
    await trigger.click();
    // The trigger reads out the current level, so match menu rows by role rather than by text.
    for (const option of [
      "Collapse all",
      "Collapse details",
      "Show latest thinking",
      "Expand all thinking",
      "Expand all",
    ]) {
      await expect(page.getByRole("menuitem", { name: option, exact: true })).toBeVisible();
    }

    await page.getByRole("menuitem", { name: "Expand all thinking", exact: true }).click();
    await expect(page.getByLabel("Select timeline detail (Expand all thinking)")).toBeVisible();
    await expect.poll(() => readStoredTimelineDetailLevel(page)).toBe("thinking");
  });

  test("each level opens what it promises", async ({ page }) => {
    test.setTimeout(180_000);
    await setTimelineDetailLevel(page, "overview");
    const agent = await startRunningMockAgent(page, {
      prefix: "timeline-detail-levels-",
      model: "ten-second-stream",
      prompt: "Stream reasoning and tool calls for the level sweep.",
    });
    try {
      await expectAgentIdle(page);

      const overviewThinking = await thinkingRowStates(page);
      expect(overviewThinking.length).toBeGreaterThan(0);
      expect(overviewThinking.every((state) => state === "false")).toBe(true);

      // "Expand all thinking" opens every thinking block and leaves tool calls alone.
      await setTimelineDetailLevel(page, "thinking");
      await page.reload();
      await expect
        .poll(async () => (await thinkingRowStates(page)).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      expect((await thinkingRowStates(page)).every((state) => state === "true")).toBe(true);
      const thinkingLevelTools = await toolRowStates(page);
      expect(thinkingLevelTools.length).toBeGreaterThan(0);
      expect(thinkingLevelTools.every((state) => state === "false")).toBe(true);

      // "Expand all" opens the tool call details on top of that.
      await setTimelineDetailLevel(page, "expanded");
      await page.reload();
      await expect
        .poll(async () => (await toolRowStates(page)).length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      expect((await thinkingRowStates(page)).every((state) => state === "true")).toBe(true);
      expect((await toolRowStates(page)).every((state) => state === "true")).toBe(true);
    } finally {
      await agent.cleanup();
    }
  });

  test("live mode keeps only the newest thinking block expanded", async ({ page }) => {
    test.setTimeout(180_000);
    await setTimelineDetailLevel(page, "live");
    const agent = await startRunningMockAgent(page, {
      prefix: "timeline-detail-live-",
      model: "ten-second-stream",
      prompt: "Stream reasoning and tool calls for the live level.",
      featureValues: { mockReasoningRepeat: 12 },
    });
    try {
      // Only sampled while a thinking row is the timeline tail: that is the window where live mode
      // is supposed to hold one block open, and sampling anywhere else would test another level.
      const onlyNewestExpanded = (badges: BadgeState[]) => {
        const tail = badges.at(-1);
        if (!tail || !isThinkingBadge(tail)) {
          return false;
        }
        const thinking = badges.filter(isThinkingBadge).map((badge) => badge.expanded);
        return thinking.length >= 2 && thinking.filter((state) => state === "true").length === 1;
      };

      // Wait for the first turn's thinking block, then send a second message so a second
      // block streams in while the first sits ready in history.
      await expect
        .poll(async () => (await thinkingRowStates(page)).length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(1);
      await expectAgentIdle(page);
      await agent.client.sendAgentMessage(agent.agentId, "Second turn: keep reasoning.");

      // While the second block streams, it alone stays expanded and the first folds back.
      await expect
        .poll(async () => onlyNewestExpanded(await badgeStates(page)), { timeout: 60_000 })
        .toBe(true);
    } finally {
      await agent.cleanup();
    }
  });

  // Separate agent on purpose: this case needs the mock to reach its tool calls inside the turn,
  // and the long reasoning the case above needs pushes them past the turn's end.
  test("live mode folds a thinking block as soon as a tool call lands below it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTimelineDetailLevel(page, "live");
    const agent = await startRunningMockAgent(page, {
      prefix: "timeline-detail-live-tail-",
      model: "ten-second-stream",
      prompt: "Stream reasoning and tool calls for the live tail rule.",
    });
    try {
      // The mock streams a thinking block and then runs tool calls in the same cycle. Once a tool
      // row is the last item, the block above it folds even though it is the newest thinking.
      await expect
        .poll(async () => liveTailState(await badgeStates(page)), { timeout: 60_000 })
        .toBe("folded");
    } finally {
      await agent.cleanup();
    }
  });

  // The pin belongs to whichever thinking block is streaming, which at the "thinking" level is
  // the row that stays expanded until the turn ends — the live level folds a block as soon as the
  // next tool call lands, too short a window to read the pin off reliably.
  test("the streaming thinking block stays pinned to its tail until the reader scrolls up", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTimelineDetailLevel(page, "thinking");
    const agent = await startRunningMockAgent(page, {
      prefix: "timeline-detail-pin-",
      model: "ten-second-stream",
      prompt: "Stream reasoning for the tail pin.",
      featureValues: { mockReasoningRepeat: 12 },
    });
    try {
      const scroll = page.getByTestId("thinking-detail-scroll").last();
      await expect.poll(() => scroll.count(), { timeout: 60_000 }).toBeGreaterThan(0);
      // Wait until the block overflows its own scroll area, so the wheel lands on it rather than
      // on the timeline behind it.
      await expect.poll(() => scroll.evaluate(readOverflow)).toBeGreaterThan(200);
      await expect.poll(() => scroll.evaluate(readTailDistance)).toBeLessThanOrEqual(40);

      // Hold one element across the scroll: the newest thinking block changes identity as the
      // stream advances, and a fresh locator would measure the wrong row.
      const pinned = await scroll.elementHandle();
      expect(pinned).not.toBeNull();
      if (!pinned) {
        return;
      }

      // Scrolling up stops the pin; new content must not yank the reader back down.
      await scroll.hover();
      await page.mouse.wheel(0, -600);
      await expect.poll(() => pinned.evaluate(readTailDistance)).toBeGreaterThan(100);
      await page.waitForTimeout(1_500);
      expect(await pinned.evaluate(readTailDistance)).toBeGreaterThan(100);
    } finally {
      await agent.cleanup();
    }
  });
});
