"""Port two sections of a host's Agents page to web/src/overrides: the terminal profile edit sheet
and the metadata generation section. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

# ---- screens/settings/terminal-profile-edit-modal.tsx ----
p = Port("screens/settings/terminal-profile-edit-modal.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('''      <View style={styles.body}>''', '''      <div className="flex flex-col gap-4 pb-2">''')
p.sub(r'returnKeyType="(\w+)"', r'enterKeyHint="\1"', count=3)
p.sub(r'\n\s*nativeID="[\w-]+"', "", count=3)
p.rep('''          <Text style={styles.submitError} testID="terminal-profile-submit-error">
            {submitError}
          </Text>''', '''          <span
            className="text-sm leading-[normal] text-red-300"
            data-testid="terminal-profile-submit-error"
          >
            {submitError}
          </span>''')
p.rep('''        <View style={styles.actions}>''', '''        <div className="mt-2 flex flex-row items-center gap-2">''')
p.rep('''            style={styles.actionButton}''', '''            className="flex-1"''', 2)
p.rep('''          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>''', '''          </Button>
        </div>
      </div>
    </AdaptiveModalSheet>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the add/edit terminal profile sheet; DOM view.", "agents-page-sections.py")

# ---- screens/settings/metadata-generation-page.tsx ----
p = Port("screens/settings/metadata-generation-page.tsx")
p.rep('import { Alert, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\nimport { cn } from "cn";\n')
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('''      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>''', '''      <div className="flex min-h-[180px] items-center justify-center text-muted-foreground">
        <LoadingSpinner size="large" />
      </div>''')
p.rep('''          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>''',
      '''          <div className={cn(settingsStyles.row, settingsStyles.rowBorder)}>''')
p.dom_tags()
p.cut_from("const styles = StyleSheet.create")
p.check(allow=('react-native"',))
p.write("the metadata generation model section; DOM view.", "agents-page-sections.py")
