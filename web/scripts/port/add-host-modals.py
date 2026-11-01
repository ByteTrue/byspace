"""Port packages/app's add-host dialogs to web/src/overrides: the method picker, the direct
connection form, the remote SSH form and the paste-pairing-link form. Same logic, DOM + Tailwind
view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

# packages/app's add-host forms share these shapes.
LABEL = "text-sm leading-[normal] font-medium text-muted-foreground"
INPUT = "rounded-lg border bg-muted px-4 py-3 text-sm leading-[normal]"
HELPER = "text-sm leading-[normal] text-muted-foreground"
ERROR = "whitespace-pre-line text-sm leading-[normal] text-destructive"
# shadcn/ui checkbox: 16px, 4px radius, input border; checked fills with the primary.
CHECKBOX = "flex size-4 shrink-0 items-center justify-center rounded-[4px] border"
CHECKBOX_OFF = "border-input bg-background dark:bg-input/30"
CHECKBOX_ON = "border-primary bg-primary"

# ---- add-host-method-modal.tsx ----
OPTION = "flex w-full flex-row items-center gap-4 rounded-xl border bg-muted p-4 text-left"
p = Port("components/add-host-method-modal.tsx")
p.rep('import { Pressable, Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('from "./adaptive-modal-sheet";', 'from "@/components/adaptive-modal-sheet";')
p.between("const styles = StyleSheet.create", "export interface AddHostMethodModalProps",
          f'const OPTION =\n  "{OPTION}";\n\n')
for key, testid, icon in (("direct", "add-host-method-direct", "ThemedLink2"),
                          ("pasteLink", "add-host-method-pair-link", "ThemedClipboardPaste")):
    handler = "handleDirect" if key == "direct" else "handlePaste"
    p.rep(f'''      <Pressable
        style={{styles.option}}
        onPress={{{handler}}}
        accessibilityRole="button"
        accessibilityLabel={{t("pairing.connectionMethods.{key}.title")}}
        testID="{testid}"
      >
        <{icon} size={{18}} uniProps={{foregroundIconMapping}} />
        <View style={{styles.optionBody}}>
          <Text style={{styles.optionText}}>{{t("pairing.connectionMethods.{key}.title")}}</Text>
          <Text style={{styles.optionSubtext}}>
            {{t("pairing.connectionMethods.{key}.description")}}
          </Text>
        </View>
      </Pressable>''', f'''      <button
        type="button"
        className={{OPTION}}
        onClick={{{handler}}}
        aria-label={{t("pairing.connectionMethods.{key}.title")}}
        data-testid="{testid}"
      >
        <{icon} size={{18}} uniProps={{foregroundIconMapping}} />
        <span className="flex flex-1 flex-col">
          <span className="text-sm leading-[normal] font-normal text-foreground">
            {{t("pairing.connectionMethods.{key}.title")}}
          </span>
          <span className="mt-1 text-sm leading-[normal] text-muted-foreground">
            {{t("pairing.connectionMethods.{key}.description")}}
          </span>
        </span>
      </button>''')
p.check()
p.write("how to add a host: direct connection or a pasted pairing link; DOM view.", "add-host-modals.py")

# ---- add-host-modal.tsx ----
p = Port("components/add-host-modal.tsx")
p.rep('import { Alert, Pressable, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\nimport { cn } from "cn";\n')
p.rep('import { StyleSheet, useUnistyles } from "react-native-unistyles";\n',
      'import { useUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('from "./adaptive-modal-sheet";', 'from "@/components/adaptive-modal-sheet";')
p.rep('const FLEX_ONE_STYLE = { flex: 1 } as const;\n', "")
p.between("const styles = StyleSheet.create", "function isIpv6Host(",
          f'const LABEL = "{LABEL}";\nconst INPUT = "{INPUT}";\n\n')
p.rep('''  const hostFieldStyle = useMemo(() => [styles.field, styles.hostField], []);
  const portFieldStyle = useMemo(() => [styles.field, styles.portField], []);
  const checkboxStyle = useMemo(
    () => [styles.checkbox, useTls ? styles.checkboxChecked : null],
    [useTls],
  );
  const passwordInputStyle = useMemo(() => [styles.input, styles.passwordInput], []);
  const useTlsAccessibilityState = useMemo(
    () => ({ checked: useTls, disabled: isSaving }),
    [isSaving, useTls],
  );
''', "")
p.rep('''      <Text style={styles.helper}>{t("pairing.direct.helper")}</Text>

      <View style={styles.portRow}>
        <View style={hostFieldStyle}>
          <Text style={styles.label}>{t("pairing.direct.fields.host")}</Text>''', f'''      <span className="{HELPER}">{{t("pairing.direct.helper")}}</span>

      <div className="flex flex-row gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={{LABEL}}>{{t("pairing.direct.fields.host")}}</span>''')
p.rep('''        </View>
        <View style={portFieldStyle}>
          <Text style={styles.label}>{t("pairing.direct.fields.port")}</Text>''', '''        </div>
        <div className="flex w-28 flex-col gap-2">
          <span className={LABEL}>{t("pairing.direct.fields.port")}</span>''')
p.rep('''        </View>
      </View>

      <Pressable
        style={styles.checkboxRow}
        onPress={handleToggleUseTls}
        disabled={isSaving}
        accessibilityRole="checkbox"
        accessibilityLabel={t("pairing.direct.fields.useSsl")}
        accessibilityState={useTlsAccessibilityState}
        testID="direct-ssl-toggle"
      >
        <View style={checkboxStyle}>
          {useTls ? (
            <View testID="direct-ssl-toggle-checked">
              <Check size={12} strokeWidth={3} color={theme.colors.accentForeground} />
            </View>
          ) : null}
        </View>
        <Text style={styles.label}>{t("pairing.direct.fields.useSsl")}</Text>
      </Pressable>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.direct.fields.password")}</Text>
        <View style={styles.passwordRow}>''', f'''        </div>
      </div>

      <button
        type="button"
        role="checkbox"
        className="flex flex-row items-center gap-3 self-start text-left disabled:opacity-50"
        onClick={{handleToggleUseTls}}
        disabled={{isSaving}}
        aria-label={{t("pairing.direct.fields.useSsl")}}
        aria-checked={{useTls}}
        data-testid="direct-ssl-toggle"
      >
        <span className={{cn("{CHECKBOX}", useTls ? "{CHECKBOX_ON}" : "{CHECKBOX_OFF}")}}>
          {{useTls ? (
            <span className="flex" data-testid="direct-ssl-toggle-checked">
              <Check size={{12}} strokeWidth={{3}} color={{theme.colors.accentForeground}} />
            </span>
          ) : null}}
        </span>
        <span className={{LABEL}}>{{t("pairing.direct.fields.useSsl")}}</span>
      </button>

      <div className="flex flex-col gap-2">
        <span className={{LABEL}}>{{t("pairing.direct.fields.password")}}</span>
        <div className="flex flex-row items-center gap-2">''')
p.rep('''          <Pressable
            style={styles.iconButton}
            onPress={handleTogglePasswordVisibility}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={''', '''          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted"
            onClick={handleTogglePasswordVisibility}
            disabled={isSaving}
            aria-label={''')
p.rep('''            testID="direct-password-visibility-toggle"
          >
            <PasswordIcon size={18} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Pressable
          style={styles.advancedToggle}
          onPress={handleToggleAdvanced}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={''', '''            data-testid="direct-password-visibility-toggle"
          >
            <PasswordIcon size={18} color={theme.colors.foregroundMuted} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="flex flex-row items-center gap-2 self-start py-1"
          onClick={handleToggleAdvanced}
          disabled={isSaving}
          aria-label={''')
p.rep('''          testID="direct-host-advanced-toggle"
        >
          <AdvancedIcon size={16} color={theme.colors.foregroundMuted} />
          <Text style={styles.advancedText}>{t("pairing.direct.advanced.label")}</Text>
        </Pressable>''', '''          data-testid="direct-host-advanced-toggle"
        >
          <AdvancedIcon size={16} color={theme.colors.foregroundMuted} />
          <span className="text-sm leading-[normal] font-medium text-foreground">
            {t("pairing.direct.advanced.label")}
          </span>
        </button>''')
p.rep('''        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}''', f'''        {{errorMessage ? <span className="{ERROR}">{{errorMessage}}</span> : null}}
      </div>

      <div className="mt-2 flex flex-row gap-3">
        <Button
          className="flex-1"''')
p.rep('''        <Button
          style={FLEX_ONE_STYLE}
          variant="default"''', '''        <Button
          className="flex-1"
          variant="default"''')
p.rep('''        </Button>
      </View>
    </AdaptiveModalSheet>''', '''        </Button>
      </div>
    </AdaptiveModalSheet>''')
p.sub(r'\n\s*nativeID="[\w-]+"', "", count=4)
p.sub(r'\n\s*placeholderTextColor=\{theme\.colors\.foregroundMuted\}', "", count=4)
p.rep('''            style={passwordInputStyle}''', '''            className={cn(INPUT, "min-w-0 flex-1")}''')
p.rep('''            style={styles.input}''', '''            className={INPUT}''', 3)
p.sub(r'returnKeyType="(\w+)"', r'enterKeyHint="\1"', count=4)
p.rep('''            secureTextEntry={!isPasswordVisible}''', '''            type={isPasswordVisible ? "text" : "password"}''')
p.check(allow=('react-native"',))
p.write("the direct connection form; DOM view.", "add-host-modals.py")

# ---- add-remote-ssh-host-modal.tsx ----
p = Port("components/add-remote-ssh-host-modal.tsx")
p.rep('import { Pressable, Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('from "./adaptive-modal-sheet";', 'from "@/components/adaptive-modal-sheet";')
p.rep('const FLEX_ONE_STYLE = { flex: 1 } as const;\n', "")
p.between("const styles = StyleSheet.create", "export interface AddRemoteSshHostModalProps", "")
p.rep('''      <Text style={styles.helper}>{t("pairing.remoteSsh.helper")}</Text>''',
      '''      <span className="text-xs leading-[normal] text-muted-foreground">
        {t("pairing.remoteSsh.helper")}
      </span>''')
p.rep('''        <View style={styles.passwordRow}>
          <View style={styles.passwordInputWrap}>''', '''        <div className="flex flex-row items-center gap-2">
          <div className="min-w-0 flex-1">''')
p.rep('''          </View>
          <Pressable
            style={styles.iconButton}
            onPress={handleTogglePasswordVisibility}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel={''', '''          </div>
          <button
            type="button"
            className="flex aspect-square shrink-0 items-center justify-center self-stretch rounded-lg border bg-muted"
            onClick={handleTogglePasswordVisibility}
            disabled={isSaving}
            aria-label={''')
p.rep('''            testID="remote-ssh-password-visibility-toggle"
          >
            <PasswordVisibilityIcon />
          </Pressable>
        </View>
      </Field>
      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}''', '''            data-testid="remote-ssh-password-visibility-toggle"
          >
            <PasswordVisibilityIcon />
          </button>
        </div>
      </Field>
      <div className="mt-2 flex flex-row gap-3">
        <Button
          className="flex-1"''')
p.rep('''        <Button
          style={FLEX_ONE_STYLE}
          onPress={handleSubmit}''', '''        <Button
          className="flex-1"
          onPress={handleSubmit}''')
p.rep('''        </Button>
      </View>
    </AdaptiveModalSheet>''', '''        </Button>
      </div>
    </AdaptiveModalSheet>''')
p.sub(r'returnKeyType="(\w+)"', r'enterKeyHint="\1"', count=2)
p.rep('''              secureTextEntry={!isPasswordVisible}''', '''              type={isPasswordVisible ? "text" : "password"}''')
# the web Button colours a component icon itself
p.rep("const ThemedTerminal = withUnistyles(Terminal);\n", "")
p.rep("          leftIcon={ThemedTerminal}", "          leftIcon={Terminal}")
p.check()
p.write("the remote SSH host form; DOM view.", "add-host-modals.py")

# ---- pair-link-modal.tsx ----
p = Port("components/pair-link-modal.tsx")
p.rep('import { Alert, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\n')
p.rep('import { StyleSheet, useUnistyles } from "react-native-unistyles";\n',
      'import { useUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('from "./adaptive-modal-sheet";', 'from "@/components/adaptive-modal-sheet";')
p.rep('const FLEX_ONE_STYLE = { flex: 1 } as const;\n', "")
p.between("const styles = StyleSheet.create", "export interface PairLinkModalProps", "")
p.rep('''      <Text style={styles.helper}>{t("pairing.link.helper")}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>{t("pairing.link.label")}</Text>''', f'''      <span className="{HELPER}">{{t("pairing.link.helper")}}</span>

      <div className="flex flex-col gap-2">
        <span className="{LABEL}">{{t("pairing.link.label")}}</span>''')
p.rep('''          nativeID="pair-link-input"
''', "")
p.rep('''          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}''', f'''          className="{INPUT}"''')
p.rep('''        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button
          style={FLEX_ONE_STYLE}''', f'''        {{errorMessage ? <span className="{ERROR}">{{errorMessage}}</span> : null}}
      </div>

      <div className="mt-2 flex flex-row gap-3">
        <Button
          className="flex-1"''')
p.rep('''        <Button
          style={FLEX_ONE_STYLE}
          variant="default"''', '''        <Button
          className="flex-1"
          variant="default"''')
p.rep('''        </Button>
      </View>
    </AdaptiveModalSheet>''', '''        </Button>
      </div>
    </AdaptiveModalSheet>''')
p.check(allow=('react-native"',))
p.write("the paste-a-pairing-link form; DOM view.", "add-host-modals.py")
