"""Port packages/app's screens/settings/host-appearance-section.tsx to web/src/overrides: same
logic, DOM + Tailwind view. The badge preview uses the new frontend's sidebar meta row."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

TRIGGER = "flex flex-row items-center gap-1 rounded-md border px-2 py-1 active:opacity-85"
TRIGGER_TEXT = "text-sm leading-[normal] text-foreground"

p = Port("screens/settings/host-appearance-section.tsx")
p.rep('import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('import { WorkspaceMetaRow } from "@/components/sidebar/workspace-meta-row";\n',
      'import { WorkspaceMetaRow } from "~/sidebar/meta-row";\n')
p.rep('''function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return pressed ? [styles.trigger, styles.triggerPressed] : styles.trigger;
}
''', f'''const TRIGGER =
  "{TRIGGER}";
''')
p.rep('''      <Pressable
        onPress={openEditor}
        hitSlop={8}
        style={styles.renameButton}
        accessibilityRole="button"
        accessibilityLabel={t("settings.host.daemon.rename.editLabel")}
        testID="host-page-label-edit-button"
      >
        <ThemedPencil size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
      </Pressable>''', '''      <button
        type="button"
        onClick={openEditor}
        className="rounded-md p-1"
        aria-label={t("settings.host.daemon.rename.editLabel")}
        data-testid="host-page-label-edit-button"
      >
        <ThemedPencil size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
      </button>''')
p.rep('''  const swatchStyle = useMemo(
    () => [styles.swatch, color === "none" ? null : { backgroundColor: identityColor(color) }],
    [color],
  );
  return <View style={swatchStyle} />;''', '''  const swatchStyle = useMemo(
    () => (color === "none" ? undefined : { backgroundColor: identityColor(color) }),
    [color],
  );
  return <span className="size-4 shrink-0 rounded-full border" style={swatchStyle} />;''')
p.rep('''          style={dropdownTriggerStyle}
          accessibilityRole="button"
          accessibilityLabel={t("settings.host.appearance.color.accessibilityLabel", {''', '''          className={TRIGGER}
          accessibilityLabel={t("settings.host.appearance.color.accessibilityLabel", {''')
p.rep('''          <ColorSwatch color={color} />
          <Text style={styles.triggerText}>{selectedLabel}</Text>''', f'''          <ColorSwatch color={{color}} />
          <span className="{TRIGGER_TEXT}">{{selectedLabel}}</span>''')
p.rep('''          testID="host-appearance-badge-display"
          style={dropdownTriggerStyle}
          accessibilityRole="button"
          accessibilityLabel''', '''          testID="host-appearance-badge-display"
          className={TRIGGER}
          accessibilityLabel''')
p.rep('''          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {HOST_BADGE_DISPLAYS''', f'''          <span className="{TRIGGER_TEXT}">{{selectedLabel}}</span>
          <ThemedChevronDown size={{ICON_SIZE.sm}} uniProps={{mutedColorMapping}} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={{200}}>
          {{HOST_BADGE_DISPLAYS''')
p.rep('''    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>''',
      '''    <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>''', 2)
p.rep('''    <View style={styles.preview} testID="host-appearance-preview">
      <Text style={styles.previewCaption}>PREVIEW</Text>
      <Text style={styles.previewTitle} numberOfLines={1}>
        {t("settings.host.appearance.preview.workspaceName")}
      </Text>''', '''    <div
      className="flex flex-col items-start gap-1 border-t bg-sidebar px-4 py-3"
      data-testid="host-appearance-preview"
    >
      <span className="mb-0.5 text-xs leading-[normal] font-medium tracking-[0.5px] text-extra-muted-foreground uppercase">
        PREVIEW
      </span>
      <span className="max-w-full shrink truncate text-sm leading-[normal] text-muted-foreground">
        {t("settings.host.appearance.preview.workspaceName")}
      </span>''')
p.rep('''          <View style={styles.nameValue}>
            <Text style={styles.nameText} numberOfLines={1}>
              {host.label}
            </Text>
            <HostRenameButton host={host} />
          </View>''', '''          <div className="flex shrink flex-row items-center gap-2">
            <span className="shrink truncate text-sm leading-[normal] text-muted-foreground">
              {host.label}
            </span>
            <HostRenameButton host={host} />
          </div>''')
p.rep('import { identityColor } from "@/styles/identity-colors";\n',
      'import { identityColor } from "@/styles/identity-colors";\nimport { cn } from "cn";\n')
p.dom_tags()
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("host name, colour and badge, with a preview row; DOM view.", "host-appearance-section.py")
