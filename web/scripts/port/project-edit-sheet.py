"""Port packages/app's components/project-edit-sheet.tsx to web/src/overrides: renaming a project and
choosing its icon, saved together. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("components/project-edit-sheet.tsx")
p.rep('''import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
''', "")
p.rep('''      <View style={styles.footer}>
        <Button variant="secondary"''', '''      <div className="flex flex-1 flex-row justify-end gap-2">
        <Button variant="secondary"''')
p.rep('''          {t("settings.project.edit.save")}
        </Button>
      </View>
    ),''', '''          {t("settings.project.edit.save")}
        </Button>
      </div>
    ),''')
p.rep('''          <View style={styles.iconField}>
            <View style={styles.iconRow}>''', '''          <div className="flex flex-col gap-2">
            <div className="flex flex-row flex-wrap items-center gap-2">''')
p.rep('''                textStyle={styles.previewText}''', '''                textStyle={PREVIEW_TEXT}''')
p.rep('''              ) : null}
            </View>
            <FormTextInput''', '''              ) : null}
            </div>
            <FormTextInput''')
p.rep('''              keyboardType="url"
            />
          </View>
        </Field>''', '''              keyboardType="url"
            />
          </div>
        </Field>''')
p.cut_from("const styles = StyleSheet.create")
p.s += '''
const PREVIEW_TEXT = { fontSize: 14, fontWeight: 500 } as const;
'''
p.check()
p.write("renaming a project and choosing its icon; DOM view.", "project-edit-sheet.py")
