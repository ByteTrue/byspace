import { beforeEach, describe, expect, it } from "vitest";
import {
  CHIEF_FAB_COMPOSER_GAP,
  CHIEF_FAB_CORNER_INSET,
  CHIEF_FAB_SIZE,
  resolveChiefFabBottom,
  resolveChiefFabClearance,
  resolveChiefFabWindowBottom,
  selectChiefFabClearance,
  useChiefFabClearanceStore,
} from "./chief-fab-clearance";

const VIEWPORT = { viewportWidth: 390, viewportHeight: 844 };

/** A message box filling the bottom of a narrow viewport, send button included. */
const COMPOSER_FRAME = { left: 16, top: 844 - 108, width: 358, height: 108 };

describe("chief fab clearance", () => {
  beforeEach(() => {
    useChiefFabClearanceStore.setState({ clearances: {} });
  });

  it("rests in the window corner while the composer never reaches it", () => {
    // A wide viewport: the composer is capped at MAX_CONTENT_WIDTH and centred,
    // so its right edge stops far short of the entry.
    expect(
      resolveChiefFabClearance({
        frame: { left: 520, top: 700, width: 820, height: 108 },
        viewportWidth: 1440,
        viewportHeight: 900,
      }),
    ).toBe(0);
    expect(resolveChiefFabBottom(0)).toBe(CHIEF_FAB_CORNER_INSET);
  });

  it("rises above the composer when the two would share the corner", () => {
    // The reported bug: a phone-width viewport where the composer's send button
    // sits under the entry's own box.
    const clearance = resolveChiefFabClearance({ frame: COMPOSER_FRAME, ...VIEWPORT });

    expect(clearance).toBe(108);
    expect(resolveChiefFabBottom(clearance)).toBe(108 + CHIEF_FAB_COMPOSER_GAP);
    expect(resolveChiefFabBottom(clearance)).toBeGreaterThan(
      CHIEF_FAB_CORNER_INSET + CHIEF_FAB_SIZE,
    );
  });

  it("stays put when a composer sits in a pane that does not reach the corner", () => {
    expect(
      resolveChiefFabClearance({
        frame: { left: 0, top: 844 - 108, width: 240, height: 108 },
        ...VIEWPORT,
      }),
    ).toBe(0);
  });

  it("stays put when the composer is scrolled above the corner entirely", () => {
    expect(
      resolveChiefFabClearance({
        frame: { left: 16, top: 0, width: 358, height: 700 },
        ...VIEWPORT,
      }),
    ).toBe(0);
  });

  it("clears the tallest composer when several panes are mounted", () => {
    expect(
      selectChiefFabClearance({
        "composer:agent-1": 108,
        "composer:agent-2": 320,
        "composer:agent-3": 96,
      }),
    ).toBe(320);
  });

  it("holds the floating window above the same composer the entry clears", () => {
    expect(resolveChiefFabWindowBottom(0)).toBeGreaterThan(CHIEF_FAB_CORNER_INSET + CHIEF_FAB_SIZE);
    expect(resolveChiefFabWindowBottom(108)).toBe(108 + CHIEF_FAB_COMPOSER_GAP);
  });

  it("withdraws only the owner that left", () => {
    const { publish } = useChiefFabClearanceStore.getState();

    publish("composer:agent-1", 120);
    publish("composer:agent-2", 90);
    publish("composer:agent-1", null);

    expect(useChiefFabClearanceStore.getState().clearances).toEqual({ "composer:agent-2": 90 });
  });

  it("keeps the published record identity when nothing changed", () => {
    const { publish } = useChiefFabClearanceStore.getState();

    publish("composer:agent-1", 120);
    const published = useChiefFabClearanceStore.getState().clearances;
    publish("composer:agent-1", 120);
    publish("composer:agent-2", null);

    expect(useChiefFabClearanceStore.getState().clearances).toBe(published);
  });
});
