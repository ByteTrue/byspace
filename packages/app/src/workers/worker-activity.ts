import type { WorkerActivityDay } from "@bytetrue/protocol/worker/rpc-schemas";

/**
 * Turning daily activity into the shape a contribution grid draws.
 *
 * Pure and separate from the renderer, so the ranges and thresholds can be
 * tested without one, and so "what counts as a heavy day" is stated once.
 *
 * The reference product's grid is 53 columns of 7 days, which is a year plus the
 * partial week at each end. That shape is copied because it is the familiar one;
 * what differs is the counting, which comes from this domain's task history.
 */

export const ACTIVITY_WEEKS = 53;
export const ACTIVITY_DAYS_PER_WEEK = 7;

export interface ActivityCell {
  /** ISO date, `YYYY-MM-DD`. */
  day: string;
  count: number;
  /** 0 is quiet, 1..3 is increasingly busy. */
  level: ActivityLevel;
  /** False for the padding cells at the ends of the range, which draw as blanks. */
  inRange: boolean;
}

export type ActivityLevel = 0 | 1 | 2 | 3;

export interface ActivityGrid {
  /** One entry per column, each with seven day cells (Sunday first). */
  weeks: ActivityCell[][];
  total: number;
  /** The busiest day's count, used to explain the legend. */
  busiest: number;
}

/** `YYYY-MM-DD` for a date, in UTC to match how the daemon stores timestamps. */
export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayKey(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Buckets a day's count into a level.
 *
 * Relative to the busiest day rather than to fixed numbers: a worker with four
 * tasks and one with four hundred should both show contrast, and fixed
 * thresholds would render one of them blank. Zero stays zero so a quiet day is
 * never shown as work.
 */
export function levelFor(count: number, busiest: number): ActivityLevel {
  if (count <= 0) return 0;
  if (busiest <= 0) return 0;
  // Four steps, as the reference product's grid has: quiet, then three
  // increasing levels of busy.
  const share = count / busiest;
  if (share > 0.66) return 3;
  if (share > 0.33) return 2;
  return 1;
}

export interface BuildActivityGridInput {
  days: readonly WorkerActivityDay[];
  /**
   * The day to treat as "today", which anchors the range. Injected so a test
   * does not depend on the clock, and so a rendering can be reproduced.
   */
  today: Date;
}

/**
 * Lays activity out as a year of weeks, ending with the week containing today.
 *
 * The grid is filled by date rather than by position in the input, so a gap in
 * the data leaves a quiet cell rather than shifting everything after it.
 */
export function buildActivityGrid(input: BuildActivityGridInput): ActivityGrid {
  const counts = new Map<string, number>();
  for (const entry of input.days) {
    counts.set(entry.day, (counts.get(entry.day) ?? 0) + entry.count);
  }
  const busiest = input.days.reduce((max, entry) => Math.max(max, entry.count), 0);

  // The last column ends on the Saturday of today's week, so the newest cell is
  // always in the same place as the reference product's.
  const todayKey = toDayKey(input.today);
  const todayDate = parseDayKey(todayKey);
  const end = new Date(todayDate);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));

  const totalCells = ACTIVITY_WEEKS * ACTIVITY_DAYS_PER_WEEK;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (totalCells - 1));

  const weeks: ActivityCell[][] = [];
  let cursor = new Date(start);
  let total = 0;
  for (let week = 0; week < ACTIVITY_WEEKS; week += 1) {
    const column: ActivityCell[] = [];
    for (let day = 0; day < ACTIVITY_DAYS_PER_WEEK; day += 1) {
      const key = toDayKey(cursor);
      const count = counts.get(key) ?? 0;
      // Future days are padding: the grid ends today, not at the end of the
      // week, so the last column is partly blank rather than partly invented.
      const inRange = cursor <= todayDate;
      if (inRange) total += count;
      column.push({
        day: key,
        count,
        level: inRange ? levelFor(count, busiest) : 0,
        inRange,
      });
      cursor = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(column);
  }

  return { weeks, total, busiest };
}

/**
 * Month labels for the top of the grid, keyed by the column they start at.
 *
 * A month is labelled at the first column whose first day falls in a new month,
 * which is where a reader looks for it.
 */
export function monthLabels(
  weeks: readonly ActivityCell[][],
): Array<{ week: number; label: string }> {
  const labels: Array<{ week: number; label: string }> = [];
  let lastMonth = -1;
  weeks.forEach((week, index) => {
    const first = week[0];
    if (!first) return;
    const month = parseDayKey(first.day).getUTCMonth();
    if (month === lastMonth) return;
    lastMonth = month;
    labels.push({
      week: index,
      label: parseDayKey(first.day).toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      }),
    });
  });
  return labels;
}
