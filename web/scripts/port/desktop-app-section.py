#!/usr/bin/env python3
"""Port packages/app's desktop-client settings rows (screens/settings/desktop-app-section.tsx):
the rows the Wails desktop app adds to General (open at login, Dock, lightweight mode, prevent
sleep) and About (version and updates, update cadence, config folder, command line, daemon URL).
The /_byspace/desktop/settings calls are the Expo file's; the view is DOM."""
from _port import Port

TRAILING = "flex flex-row items-center gap-2"
# The Expo styles ask for the mono font, but these nodes carry no code-surface marker, so the app's
# interface-font rule (apply-root-font.web.ts) has always drawn them in the interface font. Kept as
# drawn: in mono the daemon row's hint wraps to a second line.
MONO = "text-xs text-muted-foreground"

p = Port("screens/settings/desktop-app-section.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet } from "react-native-unistyles";\n', 'import { cn } from "cn";\n')
p.rep("style={[settingsStyles.row, settingsStyles.rowBorder]}",
      "className={cn(settingsStyles.row, settingsStyles.rowBorder)}", 11)
p.rep("<View style={styles.trailingActions}>", f'<View className="{TRAILING}">', 3)
p.rep("<Text style={styles.monoValue}>", f'<Text className="{MONO}">', 4)
p.rep('''          <View style={styles.shellList}>
            {shells.map((sh) => (
              <View key={sh.name} style={styles.shellRow}>
                <View
                  style={[
                    styles.shellDot,
                    sh.ours ? styles.shellDotActive : styles.shellDotInactive,
                  ]}
                />
                <Text style={styles.shellName}>{formatShellNameLabel(sh, isZh)}</Text>
                <Text style={styles.shellCmd} numberOfLines={1}>''', '''          <View className="mt-2 flex flex-col gap-1">
            {shells.map((sh) => (
              <View key={sh.name} className="flex flex-row items-center gap-2">
                <View
                  className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    sh.ours ? "bg-green-400" : "bg-muted-foreground",
                  )}
                />
                <Text className="min-w-[120px] text-xs text-foreground">
                  {formatShellNameLabel(sh, isZh)}
                </Text>
                <Text className="min-w-0 flex-1 truncate text-xs text-muted-foreground">''')
p.cut_from("const styles = StyleSheet.create((theme) => ({")
p.dom_tags()
p.check()
p.write("the Wails desktop app's General and About rows. Same logic, DOM view.",
        "desktop-app-section.py")
