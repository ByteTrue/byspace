import { useMemo, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { ICON_SIZE } from "@/styles/theme";
import {
  ACTIVITY_WEEKS,
  monthLabels,
  type ActivityCell,
  type ActivityLevel,
  type ActivityGrid,
} from "@/workers/worker-activity";

/**
 * A worker's year of activity, as a contribution grid.
 *
 * The layout is the reference product's: 53 columns, seven rows, square cells
 * with a small gap, a month strip above and a less/more legend below. Counting
 * comes from this domain's task history rather than from the reference's own
 * metric.
 *
 * Plain views rather than SVG, because a cell is a rounded square: the shape is
 * what a container draws natively, and the reference draws it the same way.
 */
export function WorkerActivityHeatmap({ grid }: { grid: ActivityGrid }): ReactElement {
  const labels = useMemo(() => monthLabels(grid.weeks), [grid.weeks]);
  // Seven fixed slots with their own names: the blanks keep the ruler aligned
  // with the grid rows, and naming them avoids keying a list by its index.
  const weekdayLabels = useMemo(
    () => [
      { key: "sunday", label: "" },
      { key: "monday", label: "Mon" },
      { key: "tuesday", label: "" },
      { key: "wednesday", label: "Wed" },
      { key: "thursday", label: "" },
      { key: "friday", label: "Fri" },
      { key: "saturday", label: "" },
    ],
    [],
  );

  const gridWidth = ACTIVITY_WEEKS * (CELL + CELL_GAP) - CELL_GAP;
  // The scrollable content is the grid plus its left label column, so the
  // gutter scrolls with the grid instead of being overlapped by it.
  const gridStyle = useMemo(() => ({ width: gridWidth + GUTTER + LABEL_GAP }), [gridWidth]);
  const stripStyle = useMemo(() => ({ width: gridWidth }), [gridWidth]);

  return (
    <View style={styles.heatmap} testID="worker-activity-heatmap">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={gridStyle}>
          <View style={styles.monthRow}>
            <View style={styles.weekdayGutter} />
            <View style={[styles.monthStrip, stripStyle]}>
              {labels.map((entry) => (
                // Positioned in pixels against the grid's own width, so a label sits
                // over the column its month starts in rather than somewhere along a
                // stretched strip.
                <MonthLabel key={`${entry.week}-${entry.label}`} entry={entry} />
              ))}
            </View>
          </View>

          <View style={styles.bodyRow}>
            <View style={styles.weekdayGutter}>
              {weekdayLabels.map((slot) => (
                <Text key={slot.key} style={styles.weekdayLabel}>
                  {slot.label}
                </Text>
              ))}
            </View>
            <View style={styles.grid}>
              {grid.weeks.map((week, weekIndex) => (
                <View key={week[0]?.day ?? weekIndex} style={styles.column}>
                  {week.map((cell) => (
                    <ActivityCellView key={cell.day} cell={cell} />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.legendRow, gridStyle]}>
        <Text style={styles.legendText}>
          {grid.total === 0
            ? "No recorded activity yet"
            : `${grid.total} task event${grid.total === 1 ? "" : "s"} in the last year`}
        </Text>
        <View style={styles.legendScale}>
          <Text style={styles.legendText}>Less</Text>
          {[0, 1, 2, 3].map((level) => (
            <View key={level} style={[styles.cell, levelStyles[level as ActivityLevel]]} />
          ))}
          <Text style={styles.legendText}>More</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * One day.
 *
 * Padding cells are drawn at all, faintly, so the grid keeps its shape instead
 * of growing a ragged edge at the end of the range.
 */
/**
 * One month label.
 *
 * Its own component so the pixel offset can be computed with a hook rather than
 * built inline, which this repository forbids in a prop.
 */
function MonthLabel({ entry }: { entry: { week: number; label: string } }): ReactElement {
  const style = useMemo(
    () => [styles.monthLabel, { left: entry.week * (CELL + CELL_GAP) }],
    [entry.week],
  );
  return <Text style={style}>{entry.label}</Text>;
}

function ActivityCellView({ cell }: { cell: ActivityCell }): ReactElement {
  const style = cell.inRange ? levelStyles[cell.level] : styles.cellPadding;
  return (
    <View
      style={[styles.cell, style]}
      testID={`activity-cell-${cell.day}`}
      accessibilityLabel={`${cell.day}: ${cell.count} task event${cell.count === 1 ? "" : "s"}`}
    />
  );
}

export interface TaskTypeSlice {
  label: string;
  count: number;
  color: string;
}

/**
 * A breakdown of a worker's tasks.
 *
 * A ring rather than a bar chart: the reference draws one, and for two to four
 * categories it reads at a glance. The ring is drawn with a border on a circle,
 * which is exactly a ring and needs no path arithmetic.
 */
export function WorkerTaskBreakdown({
  slices,
  total,
}: {
  slices: TaskTypeSlice[];
  total: number;
}): ReactElement {
  const present = slices.filter((slice) => slice.count > 0);

  return (
    <View style={styles.breakdown} testID="worker-task-breakdown">
      <BreakdownRing slices={present} total={total} />
      <View style={styles.breakdownLegend}>
        {slices.map((slice) => (
          <View key={slice.label} style={styles.breakdownRow}>
            <View style={[styles.dot, { backgroundColor: slice.color }]} />
            <Text style={styles.breakdownLabel}>{slice.label}</Text>
            <Text style={styles.breakdownCount}>{slice.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The ring.
 *
 * With nothing to show it is a single quiet circle rather than an empty hole,
 * so an idle worker still reads as a shape rather than as a missing chart.
 */
function BreakdownRing({
  slices,
  total,
}: {
  slices: readonly TaskTypeSlice[];
  total: number;
}): ReactElement {
  if (total === 0 || slices.length === 0) {
    return <View style={[styles.ring, styles.ringEmpty]} />;
  }
  // One category fills the ring, so it is drawn as a full circle rather than as
  // a nearly-complete arc with a seam.
  if (slices.length === 1) {
    return <View style={[styles.ring, { borderColor: slices[0]!.color }]} />;
  }
  const base = slices[0]!;
  const rest = slices.slice(1);
  return (
    <View style={[styles.ring, { borderColor: base.color }]}>
      {rest.map((slice, index) => (
        <View
          key={slice.label}
          style={[
            styles.ringOverlay,
            {
              borderColor: slice.color,
              // Wedges are split evenly enough to read the mix; the legend
              // carries the exact counts, which is where they belong.
              transform: [{ rotate: `${(index + 1) * (360 / (rest.length + 1))}deg` }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const CELL = 11;
const CELL_GAP = 4;
/** Width of the weekday label column. Fixed so the months line up with it. */
const GUTTER = 28;
const LABEL_GAP = 8;

const styles = StyleSheet.create((theme) => ({
  heatmap: { gap: theme.spacing[2] },
  monthRow: { flexDirection: "row" },
  monthStrip: { flex: 1, position: "relative", height: ICON_SIZE.sm },
  monthLabel: {
    position: "absolute",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  bodyRow: { flexDirection: "row", gap: LABEL_GAP },
  weekdayGutter: { width: GUTTER, gap: CELL_GAP },
  weekdayLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    height: CELL,
    lineHeight: CELL,
  },
  grid: { flexDirection: "row", gap: CELL_GAP },
  column: { gap: CELL_GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  // Padding cells use a fainter fill than a quiet day, so the end of the range
  // reads as "not yet" rather than as "nothing happened".
  cellPadding: { width: CELL, height: CELL, borderRadius: 3, opacity: 0.4 },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  legendScale: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },

  breakdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[6],
    flexWrap: "wrap",
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  ringEmpty: { borderColor: theme.colors.surface2 },
  ringOverlay: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 20,
    // Only the wedge's sweep is drawn; the rest is transparent so the ring
    // beneath shows through.
    borderTopColor: "transparent",
    borderRightColor: "transparent",
  },
  breakdownLegend: { gap: theme.spacing[2], flexShrink: 1 },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  breakdownCount: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

/**
 * The heat levels.
 *
 * The reference product's own four steps, which are a single hue stepping in
 * lightness. Written as explicit values because they are a scale rather than a
 * set of independent colors, and deriving them from the theme would break the
 * progression the legend promises.
 */
const levelStyles = StyleSheet.create((theme) => ({
  0: { backgroundColor: theme.colors.surface2 },
  1: { backgroundColor: "#e6f7ec" },
  2: { backgroundColor: "#b3e6c7" },
  3: { backgroundColor: "#5cb870" },
}));
