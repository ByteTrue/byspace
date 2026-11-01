"""Port packages/app's components/rename-modal.tsx to web/src/overrides: the rename dialog used for
hosts, workspaces and tabs, on the same AdaptiveModalSheet chrome as packages/app. Same logic,
DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("components/rename-modal.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('import { isWeb } from "@/constants/platform";\n', "")
# packages/app's web branch: `node` is the text input's handle, never an HTMLInputElement, so the
# Expo app only focuses the field there (the caret lands at the end).
p.rep('''      node.focus();
      if (isWeb && node instanceof HTMLInputElement) {
        node.setSelectionRange(0, length);
      } else if (!isWeb && length > 0) {
        node.replaceText(node.getText(), { start: 0, end: length });
      }''', '''      node.focus();''')
p.rep('''    const length = initialValue.length;
    const timeout''', '''    const timeout''')
p.rep('''      <View style={styles.body}>''', '''      <div className="flex flex-col gap-3 pb-2">''')
p.rep('''          style={styles.input}''',
      '''          className="rounded-md border bg-background p-3 text-sm leading-[normal]"''')
p.rep('''          <Text style={styles.errorText} testID={errorTestID}>
            {error}
          </Text>''', '''          <span className="text-sm leading-[normal] text-red-300" data-testid={errorTestID}>
            {error}
          </span>''')
p.rep('''        <View style={styles.actions}>''', '''        <div className="flex flex-row items-center gap-2">''')
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
p.write("the rename dialog (hosts, workspaces, tabs); DOM view.", "rename-modal.py")
