#!/usr/bin/env python3
"""Port packages/app's Appearance settings (screens/settings/appearance/appearance-section.tsx):
theme, terminal scheme, detail level, chat outline, sidebar entries, fonts and syntax theme. The
drafts, clamping and commit-on-blur are the Expo file's; the view is DOM."""
from _port import Port

TRIGGER = "flex flex-row items-center gap-1 rounded-md border px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:opacity-85"
ROW_WITH_BORDER = "flex flex-row items-center justify-between border-t p-4"
INPUT = "min-h-9 rounded-[10px] border border-input bg-transparent px-2.5 py-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-8 md:py-1 dark:bg-input/30"

p = Port("screens/settings/appearance/appearance-section.tsx")
p.rep('import { Text, View, type PressableStateCallbackType } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";',
      'import { withUnistyles } from "react-native-unistyles";')
p.rep('} from "lucide-react-native";', '} from "lucide-react";')
p.rep('import { AppearancePreview } from "./appearance-preview";',
      'import { AppearancePreview } from "@/screens/settings/appearance/appearance-preview";')
p.rep('import { SidebarNavSection } from "./sidebar-nav-section";',
      'import { SidebarNavSection } from "@/screens/settings/appearance/sidebar-nav-section";\n'
      'import type { CSSProperties } from "react";')

p.rep('''function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}''', f'''const TRIGGER = "{TRIGGER}";
const ROW_WITH_BORDER = "{ROW_WITH_BORDER}";''')
p.rep("          style={dropdownTriggerStyle}\n", "          className={TRIGGER}\n", 4)
p.rep("<Text style={styles.triggerText}>{selectedLabel}</Text>",
      '<span className="text-sm leading-[normal] text-foreground">{selectedLabel}</span>', 4)

p.rep('''  const swatchStyle = useMemo(() => [styles.swatch, { backgroundColor: color }], [color]);
  return <View style={swatchStyle} />;''', '''  const swatchStyle = useMemo<CSSProperties>(() => ({ backgroundColor: color }), [color]);
  return <span className="size-4 shrink-0 rounded-full border" style={swatchStyle} />;''')

p.rep("<View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>",
      "<View className={withBorder ? ROW_WITH_BORDER : settingsStyles.row}>", 2)
p.rep('''        placeholderTextColor={styles.placeholderColor.color}
''', "")
p.rep("        style={styles.fontFamilyInput}",
      f'        className="{INPUT} max-w-[380px] shrink grow text-left text-xs"')
p.rep("          style={styles.sizeInput}", f'          className="{INPUT} w-16 text-right text-sm"')
p.rep("      <View style={styles.sizeField}>", '      <View className="flex flex-row items-center gap-2">')
p.rep("<Text style={styles.unit}>px</Text>", '<span className="text-sm text-muted-foreground">px</span>')
p.rep("        <View style={styles.preview}>", '        <View className="mt-4">')
p.rep('''  return (
    <View>
      <SettingsSection title={t("settings.appearance.theme.title")}>''', '''  return (
    <View className="flex flex-col">
      <SettingsSection title={t("settings.appearance.theme.title")}>''')
p.cut_from("const styles = StyleSheet.create((theme) => ({")
p.dom_tags()
p.check()
p.write("theme, terminal scheme, detail level, fonts, syntax theme. Same logic, DOM view.",
        "appearance-section.py")
