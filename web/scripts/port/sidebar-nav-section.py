#!/usr/bin/env python3
"""Port packages/app's sidebar entries settings (screens/settings/appearance/sidebar-nav-section.tsx):
each sidebar entry with its shortcut, move up/down for the menu's entries, and a visibility switch."""
from _port import Port

p = Port("screens/settings/appearance/sidebar-nav-section.tsx")
p.rep('import { Text, View } from "react-native";\n', 'import { cn } from "cn";\n')
p.rep('} from "lucide-react-native";', '} from "lucide-react";')
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";',
      'import { withUnistyles } from "react-native-unistyles";')
p.rep('''  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`sidebar-nav-item-${item.key}`}>
      <View style={styles.rowMain}>''', '''  return (
    <View
      className={cn(settingsStyles.row, !isFirst && settingsStyles.rowBorder, "gap-2")}
      data-testid={`sidebar-nav-item-${item.key}`}
    >
      <View className="flex flex-1 flex-row items-center gap-2">''')
p.rep('''        <Text style={settingsStyles.rowTitle} numberOfLines={1}>''',
      '''        <Text className={cn(settingsStyles.rowTitle, "truncate")}>''')
p.rep('''      <View style={styles.rowActions}>
        {reorderable ? (
          <View style={styles.reorderCluster}>''', '''      <View className="flex flex-row items-center gap-3">
        {reorderable ? (
          <View className="flex flex-row items-center overflow-hidden rounded-md border bg-muted">''')
p.rep("import { useCallback, useMemo, type ReactElement } from \"react\";",
      "import { useCallback, useMemo, type ReactElement } from \"react\";")
p.cut_from("const styles = StyleSheet.create((theme) => ({")
p.dom_tags()
p.check()
p.write("sidebar entries — shortcut, reorder and visibility. Same logic, DOM view.",
        "sidebar-nav-section.py")
