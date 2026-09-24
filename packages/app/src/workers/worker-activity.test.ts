/**
 * Tests for the activity grid.
 *
 * The interesting parts are the range and the bucketing: where the grid starts
 * and ends, that a gap in the data stays a gap, and that a worker with four
 * tasks and one with four hundred both show contrast.
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_DAYS_PER_WEEK,
  ACTIVITY_WEEKS,
  buildActivityGrid,
  levelFor,
  monthLabels,
  toDayKey,
} from "@/workers/worker-activity";

/** A fixed anchor so nothing here depends on the clock. */
const TODAY = new Date("2026-09-24T12:00:00.000Z");

function day(date: string, count: number) {
  return { day: date, count };
}

describe("activity levels", () => {
  it("keeps zero as zero", () => {
    // A quiet day must never be shown as work.
    expect(levelFor(0, 10)).toBe(0);
  });

  it("scales against the busiest day rather than fixed thresholds", () => {
    // Four tasks and four hundred must both show contrast; fixed thresholds
    // would flatten one of them.
    expect(levelFor(1, 4)).toBe(1);
    expect(levelFor(4, 4)).toBe(3);
    expect(levelFor(10, 400)).toBe(1);
    expect(levelFor(400, 400)).toBe(3);
  });

  it("treats every day as quiet when nothing has happened", () => {
    expect(levelFor(0, 0)).toBe(0);
  });

  it("steps the three busy levels against the busiest day", () => {
    expect(levelFor(5, 5)).toBe(3);
    expect(levelFor(4, 5)).toBe(3);
    expect(levelFor(3, 5)).toBe(2);
    expect(levelFor(1, 5)).toBe(1);
  });
});

describe("activity grid shape", () => {
  it("is a year of weekly columns", () => {
    const grid = buildActivityGrid({ days: [], today: TODAY });
    expect(grid.weeks).toHaveLength(ACTIVITY_WEEKS);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(ACTIVITY_DAYS_PER_WEEK);
    }
  });

  it("ends on the week containing today", () => {
    // 2026-09-24 is a Thursday, so the last column runs Sun 20th to Sat 26th.
    const grid = buildActivityGrid({ days: [], today: TODAY });
    const last = grid.weeks[grid.weeks.length - 1]!;
    expect(last[0]?.day).toBe("2026-09-20");
    expect(last[6]?.day).toBe("2026-09-26");
  });

  it("marks days after today as padding", () => {
    // The grid ends today, so the last column is partly blank rather than
    // partly invented.
    const grid = buildActivityGrid({ days: [], today: TODAY });
    const last = grid.weeks[grid.weeks.length - 1]!;
    expect(last[4]?.inRange).toBe(true); // Thursday, today
    expect(last[5]?.inRange).toBe(false); // Friday
    expect(last[6]?.inRange).toBe(false);
  });

  it("places a day's count in its own cell", () => {
    const grid = buildActivityGrid({ days: [day("2026-09-24", 3)], today: TODAY });
    const flat = grid.weeks.flat();
    const cell = flat.find((entry) => entry.day === "2026-09-24");
    expect(cell?.count).toBe(3);
    expect(cell?.level).toBe(3);
  });

  it("leaves a gap as a gap rather than shifting later days", () => {
    // Filling by date rather than by input position is what keeps this true.
    const grid = buildActivityGrid({
      days: [day("2026-09-20", 1), day("2026-09-24", 2)],
      today: TODAY,
    });
    const flat = grid.weeks.flat();
    expect(flat.find((entry) => entry.day === "2026-09-22")?.count).toBe(0);
    expect(flat.find((entry) => entry.day === "2026-09-24")?.count).toBe(2);
  });

  it("sums only days inside the range", () => {
    const grid = buildActivityGrid({
      days: [day("2026-09-24", 2), day("2026-09-25", 5)],
      today: TODAY,
    });
    // The 25th is after today, so it is outside and must not count.
    expect(grid.total).toBe(2);
  });

  it("reports the busiest day for the legend", () => {
    const grid = buildActivityGrid({
      days: [day("2026-09-20", 1), day("2026-09-24", 7)],
      today: TODAY,
    });
    expect(grid.busiest).toBe(7);
  });

  it("is empty but well formed with no data at all", () => {
    const grid = buildActivityGrid({ days: [], today: TODAY });
    expect(grid.total).toBe(0);
    expect(grid.busiest).toBe(0);
    expect(grid.weeks.flat().every((cell) => cell.level === 0)).toBe(true);
  });
});

describe("month labels", () => {
  it("labels the column where each month begins", () => {
    const grid = buildActivityGrid({ days: [], today: TODAY });
    const labels = monthLabels(grid.weeks);
    // A year of columns crosses twelve months, and the first column starts one.
    expect(labels.length).toBeGreaterThanOrEqual(12);
    expect(labels[0]?.week).toBe(0);
    for (const label of labels) {
      expect(label.label.length).toBeGreaterThan(0);
    }
  });

  it("does not repeat a month on consecutive columns", () => {
    const grid = buildActivityGrid({ days: [], today: TODAY });
    const labels = monthLabels(grid.weeks);
    const weeksUsed = labels.map((entry) => entry.week);
    expect(new Set(weeksUsed).size).toBe(weeksUsed.length);
  });
});

describe("day keys", () => {
  it("formats as a plain date", () => {
    expect(toDayKey(new Date("2026-09-24T23:59:59.000Z"))).toBe("2026-09-24");
  });
});
