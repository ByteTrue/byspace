#!/usr/bin/env python3
"""Port packages/app's app diagnostic sheet (components/app-diagnostic-sheet.tsx): runs the client,
desktop and per-host checks with live progress, then shows the redacted report to copy. The
collection is the Expo file's; the view is DOM."""
from _port import Port

ICON_BUTTON = "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50"

p = Port("components/app-diagnostic-sheet.tsx")
p.rep('import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";\n', "")
p.rep('import { Copy, RotateCw } from "lucide-react-native";', 'import { Copy, RotateCw } from "lucide-react";')
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";', 'import { withUnistyles } from "react-native-unistyles";')
p.rep('''  const iconButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
    ],
    [],
  );

  const disabledIconButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && styles.iconButtonHovered,
      diagnostic ? null : styles.disabled,
    ],
    [diagnostic],
  );
''', "")
p.rep('''        <View style={styles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={disabledIconButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.diagnostics.app.copyAccessibility")}
          >
            <ThemedCopy size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={iconButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={''', f'''        <View className="flex flex-row items-center gap-1">
          <button
            type="button"
            onClick={{handleCopyPress}}
            disabled={{!diagnostic}}
            className="{ICON_BUTTON}"
            aria-label={{t("settings.diagnostics.app.copyAccessibility")}}
          >
            <ThemedCopy size={{ICON_SIZE.sm}} uniProps={{foregroundMutedColorMapping}} />
          </button>
          <button
            type="button"
            onClick={{handleRefreshPress}}
            disabled={{loading}}
            className="{ICON_BUTTON} disabled:opacity-100"
            aria-label={{''')
p.rep('''              <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
            )}
          </Pressable>
        </View>''', '''              <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
            )}
          </button>
        </View>''')
p.rep('''    [
      diagnostic,
      disabledIconButtonStyle,
      handleCopyPress,
      handleRefreshPress,
      iconButtonStyle,
      loading,
      t,
    ],''', '''    [diagnostic, handleCopyPress, handleRefreshPress, loading, t],''')
p.rep("          <View style={styles.progressContent}>", '          <View className="flex flex-col gap-3 p-4">')
p.rep("<View style={styles.progressRow}>", '<View className="flex min-h-6 flex-row items-center gap-2">')
p.rep("<View key={row.id} style={styles.progressRow}>", '<View key={row.id} className="flex min-h-6 flex-row items-center gap-2">')
p.rep("<Text style={styles.mutedText}>{t(", '<Text className="flex-1 text-sm text-muted-foreground">{t(')
p.rep('''                    <View
                      style={row.status === "failed" ? styles.statusDotFailed : styles.statusDot}
                    />
                  )}
                  <Text
                    style={styles.mutedText}
                  >{`${row.label}: ${formatProgressStatus(row.status)}`}</Text>''', '''                    <View
                      className={
                        row.status === "failed"
                          ? "size-2 rounded-full bg-destructive"
                          : "size-2 rounded-full bg-primary"
                      }
                    />
                  )}
                  <Text className="flex-1 text-sm text-muted-foreground">
                    {`${row.label}: ${formatProgressStatus(row.status)}`}
                  </Text>''')
p.cut_from("const styles = StyleSheet.create((theme) => ({")
p.dom_tags()
p.check()
p.write("the app diagnostic — live progress, then the redacted report. Same logic, DOM view.",
        "app-diagnostic-sheet.py")
