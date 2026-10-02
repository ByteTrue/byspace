import { StyleSheet } from "react-native-unistyles";

/**
 * The optical vertical offset every sidebar label shares.
 *
 * It is a `marginTop`, and a negative margin on a label inside a centred flex container moves the
 * text by about half its value: -3 renders as roughly 1.5px of lift.
 *
 * That is the lift a row wants. With no offset a label's ink box (cap height _and_ the descenders
 * in "workspace", "History", "Schedules") centres 1px below the icon's centre, and the ascending
 * glyphs carry more visual weight than the descenders, so the eye reads the ink as sitting low.
 * Six sidebar rows measured against their icons settled on -3 (issue 062, probe19).
 *
 * Every sidebar label layer takes the offset from here, so a new nav row cannot forget it and the
 * value moves in one place.
 */
export const SIDEBAR_LABEL_OPTICAL_OFFSET = -3;

export const sidebarLabelStyles = StyleSheet.create((theme) => {
  /** What the two label layers share: the interface text size, and the optical offset. */
  const labelBase = {
    fontSize: theme.fontSize.base,
    marginTop: SIDEBAR_LABEL_OPTICAL_OFFSET,
  };

  return {
    /**
     * The BySpace title in a sidebar's corner row. It is a title-bar shape rather than a row: the
     * label is centred across the whole sidebar, so the corner control on its left (the collapse
     * toggle, the close button) cannot push it off the sidebar's axis.
     */
    title: {
      ...labelBase,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.foreground,
    },
    /** A nav row's label — New workspace, History, Search, Schedules. */
    row: {
      ...labelBase,
      fontWeight: theme.fontWeight.normal,
      color: theme.colors.foregroundMuted,
    },
    rowHighlighted: {
      color: theme.colors.foreground,
    },
  };
});
