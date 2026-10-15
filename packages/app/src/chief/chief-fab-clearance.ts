import { create } from "zustand";

/**
 * How much room the bottom edge of the screen already spends on a message box.
 *
 * The Chief entry is pinned to the window's bottom-right corner, which is
 * exactly where a chat composer puts its send button: on any viewport narrow
 * enough for the two to meet, the entry covers it. Composers measure
 * themselves here and the entry rests above whatever was published, so the two
 * are mutually exclusive by construction rather than by a breakpoint guess.
 *
 * Several composers can be mounted at once — split panes, retained tabs, the
 * Chief window's own composer — so entries are keyed by owner and the tallest
 * one wins. A hidden retained panel measures zero; that is "not rendered", and
 * it withdraws its entry instead of publishing the zero.
 */
interface ChiefFabClearanceState {
  clearances: Record<string, number>;
  publish: (ownerId: string, clearance: number | null) => void;
}

/** Size of the entry, and the box every publisher is tested against. */
export const CHIEF_FAB_SIZE = 48;
/** Resting inset from the corner when nothing occupies the bottom edge. */
export const CHIEF_FAB_CORNER_INSET = 20;
/** Gap between the entry and the composer it yields to. */
export const CHIEF_FAB_COMPOSER_GAP = 8;

export interface ChiefFabFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const useChiefFabClearanceStore = create<ChiefFabClearanceState>()((set) => ({
  clearances: {},
  publish: (ownerId, clearance) =>
    set((state) => {
      const current = state.clearances[ownerId];
      if (clearance === null) {
        if (current === undefined) {
          return state;
        }
        const next = { ...state.clearances };
        delete next[ownerId];
        return { clearances: next };
      }
      if (current === clearance) {
        return state;
      }
      return { clearances: { ...state.clearances, [ownerId]: clearance } };
    }),
}));

/**
 * How far the entry has to rise to clear a composer, given that composer's
 * frame in window coordinates. Zero when the composer never reaches the
 * corner — a message box in a left pane, or one on a screen wide enough that
 * the two cannot meet, leaves the entry where it is.
 *
 * Exported for tests.
 */
export function resolveChiefFabClearance(input: {
  frame: ChiefFabFrame;
  viewportWidth: number;
  viewportHeight: number;
}): number {
  const entryRight = input.viewportWidth - CHIEF_FAB_CORNER_INSET;
  const entryLeft = entryRight - CHIEF_FAB_SIZE;
  const entryBottom = input.viewportHeight - CHIEF_FAB_CORNER_INSET;
  const entryTop = entryBottom - CHIEF_FAB_SIZE;
  const overlapsHorizontally =
    input.frame.left < entryRight && input.frame.left + input.frame.width > entryLeft;
  const overlapsVertically =
    input.frame.top < entryBottom && input.frame.top + input.frame.height > entryTop;
  if (!overlapsHorizontally || !overlapsVertically) {
    return 0;
  }
  return input.viewportHeight - input.frame.top;
}

/** Exported for tests. */
export function selectChiefFabClearance(clearances: Record<string, number>): number {
  let clearance = 0;
  for (const value of Object.values(clearances)) {
    clearance = Math.max(clearance, value);
  }
  return clearance;
}

export function useChiefFabClearance(): number {
  return useChiefFabClearanceStore((state) => selectChiefFabClearance(state.clearances));
}

/** Bottom offset for the entry. Exported for tests. */
export function resolveChiefFabBottom(clearance: number): number {
  return clearance > 0 ? clearance + CHIEF_FAB_COMPOSER_GAP : CHIEF_FAB_CORNER_INSET;
}

/**
 * Bottom offset for the floating window, which stands in for the entry while
 * open. It clears the same composer; with nothing to clear it keeps its own
 * inset from the corner, above where the entry rests.
 */
export function resolveChiefFabWindowBottom(clearance: number): number {
  return clearance > 0
    ? clearance + CHIEF_FAB_COMPOSER_GAP
    : CHIEF_FAB_CORNER_INSET + CHIEF_FAB_SIZE + 12;
}
