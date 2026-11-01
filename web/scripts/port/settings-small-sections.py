"""Port the small host-settings files of packages/app to web/src/overrides: the settings textarea,
the default shell, daemon service and network sections. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

# ---- components/settings-textarea.tsx ----
p = Port("components/settings-textarea.tsx")
p.rep('''import type { StyleProp, TextStyle } from "react-native";
import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
''', '''import { useEffect, useRef } from "react";
import { cn } from "cn";
''')
p.rep('''import { EditingTextInput as TextInput } from "@/components/ui/text-input";''',
      '''import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";''')
p.rep('''  style?: StyleProp<TextStyle>;
}''', '''  /** Classes for the textarea (the Expo prop is a style). */
  className?: string;
}''')
p.rep('''  testID,
  style,
}: SettingsTextAreaProps) {
  const { theme } = useUnistyles();
  const inputStyle = useMemo(() => [styles.input, style], [style]);

  return (''', '''  testID,
  className,
}: SettingsTextAreaProps) {
  // packages/app hands `value` over once, so a parent that resets it (the system prompt's Reset)
  // left the edited text on screen with Save disabled. Show what the parent holds; typing keeps
  // the two equal, so this only acts on an outside change.
  const inputRef = useRef<EditingTextInputHandle>(null);
  useEffect(() => {
    if (inputRef.current && inputRef.current.getText() !== value) inputRef.current.replaceText(value);
  }, [value]);

  return (''')
p.rep('''    <TextInput
      testID={testID}''', '''    <TextInput
      ref={inputRef}
      testID={testID}''')
p.rep('''      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      style={inputStyle}
    />''', '''      placeholder={placeholder}
      className={cn(
        "block min-h-24 w-full resize-none bg-transparent px-4 py-3 text-sm leading-[normal] text-foreground placeholder:text-muted-foreground",
        className,
      )}
    />''')
p.rep('''    <View style={settingsStyles.card}>
      <SettingsTextArea {...props} />
    </View>''', '''    <div className={settingsStyles.card}>
      <SettingsTextArea {...props} />
    </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("a multiline settings field, a bare textarea in a settings card.", "settings-small-sections.py")

# ---- screens/settings/default-shell-section.tsx ----
p = Port("screens/settings/default-shell-section.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('''      <View style={settingsStyles.card} testID="terminal-default-shell-card">
        <View style={styles.fieldWrapper}>''', '''      <div className={settingsStyles.card} data-testid="terminal-default-shell-card">
        <div className="flex flex-col gap-2 p-4">''')
p.rep('''            <Text style={styles.errorText} testID="terminal-default-shell-error">
              {saveError}
            </Text>''', '''            <span
              className="text-xs leading-[normal] text-status-danger"
              data-testid="terminal-default-shell-error"
            >
              {saveError}
            </span>''')
p.rep('''        </View>
      </View>
    </SettingsSection>''', '''        </div>
      </div>
    </SettingsSection>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the default shell picker, DOM view.", "settings-small-sections.py")

# ---- screens/settings/daemon-service-section.tsx ----
p = Port("screens/settings/daemon-service-section.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('''        <View style={settingsStyles.card}>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.daemon.service.unavailable")}
          </Text>
        </View>''', '''        <div className={settingsStyles.card}>
          <span className={settingsStyles.rowHint}>
            {t("settings.host.daemon.service.unavailable")}
          </span>
        </div>''')
p.rep('''        <View style={stylesLocal.errorWrap}>''', '''        <div className="mb-2">''')
p.rep('''        </View>
      ) : null}
      <View style={settingsStyles.card} testID="host-page-service-card">''', '''        </div>
      ) : null}
      <div className={settingsStyles.card} data-testid="host-page-service-card">''')
p.dom_tags()
p.cut_from("const stylesLocal = {")
p.check()
p.write("the daemon service toggle, DOM view.", "settings-small-sections.py")

# ---- screens/settings/network-section.tsx ----
p = Port("screens/settings/network-section.tsx")
p.rep('import { Alert, Pressable, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\n')
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\nimport { cn } from "cn";\n')
p.rep('''        <View style={settingsStyles.card}>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.daemon.network.unavailable")}
          </Text>
        </View>''', '''        <div className={settingsStyles.card}>
          <span className={settingsStyles.rowHint}>
            {t("settings.host.daemon.network.unavailable")}
          </span>
        </div>''')
p.rep('''        <View style={styles.errorWrap}>''', '''        <div className="mb-2">''', 2)
# The row is a pressable that also holds a button; on the web it is a div with a click handler,
# so the Edit button is not a button inside a button.
p.rep('''        <Pressable
          style={[settingsStyles.row, settingsStyles.rowBorder]}
          onPress={handleOpenSheet}
          accessibilityRole="button"
          testID="host-page-network-password-row"
        >''', '''        <div
          className={cn(settingsStyles.row, settingsStyles.rowBorder, "cursor-pointer")}
          onClick={handleOpenSheet}
          role="button"
          tabIndex={-1}
          data-testid="host-page-network-password-row"
        >''')
p.rep('''            {t("settings.host.daemon.network.password.edit")}
          </Button>
        </Pressable>''', '''            {t("settings.host.daemon.network.password.edit")}
          </Button>
        </div>''')
p.rep('''        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>''',
      '''        <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>''')
p.rep('''        <View style={styles.passwordRow}>
          <View style={styles.passwordInputWrap}>''', '''        <div className="flex flex-row items-center gap-2">
          <div className="min-w-0 flex-1">''')
p.rep('''          </View>
          <Pressable
            style={styles.iconButton}
            onPress={handleToggleVisibility}
            accessibilityRole="button"
            accessibilityLabel={t("settings.host.daemon.network.password.toggleVisibility")}
            testID="host-page-network-password-visibility"
          >''', '''          </div>
          <button
            type="button"
            className="p-1"
            onClick={handleToggleVisibility}
            aria-label={t("settings.host.daemon.network.password.toggleVisibility")}
            data-testid="host-page-network-password-visibility"
          >''')
p.rep('''            )}
          </Pressable>
        </View>
      </Field>
      <View style={styles.sheetActions}>''', '''            )}
          </button>
        </div>
      </Field>
      <div className="mt-4 flex flex-row items-center justify-end gap-2">''')
p.rep('''            textStyle={destructiveColorMapping as never}
''', '''            className="text-destructive"
''')
p.rep('''const destructiveColorMapping = (theme: { colors: { destructive: string } }) => ({
  color: theme.colors.destructive,
});
''', "")
p.rep('''              autoCorrect={false}
              secureTextEntry={!isPasswordVisible}
              returnKeyType="done"''', '''              autoCorrect={false}
              type={isPasswordVisible ? "text" : "password"}
              enterKeyHint="done"''')
p.dom_tags()
p.dom_attrs()
p.cut_from("const styles = StyleSheet.create")
p.check(allow=('react-native"',))
p.write("access password and LAN exposure, DOM view.", "settings-small-sections.py")
