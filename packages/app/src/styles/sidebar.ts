import { StyleSheet } from "react-native-unistyles";

export const sidebarLabelStyles = StyleSheet.create((theme) => {
  const labelBase = {
    fontSize: theme.fontSize.base,
  };

  return {
    /** The BySpace app-menu trigger label in the sidebar's top row. */
    title: {
      ...labelBase,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.foreground,
    },
    /** A sidebar action or navigation label — Chief, Add project, Settings rows. */
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
