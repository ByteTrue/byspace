import { StyleSheet } from "react-native-unistyles";

/**
 * The optical vertical offset every sidebar label shares.
 *
 * Measured against the icon's centre: with no offset a label's ink box (cap height _and_ the
 * descenders in "workspace", "History", "Schedules") centres 1px below the icon's centre, which
 * reads as the text sitting low. -1px is what the ink box needs; the extra pixel covers the fact
 * that the ascending glyphs carry more visual weight than the descenders, so the eye reads the
 * cap band as the text's middle. The cap band then sits 1px above the icon's centre and the
 * x-height band 0.5px below, straddling it.
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
