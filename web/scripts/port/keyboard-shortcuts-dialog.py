"""Port packages/app's components/keyboard-shortcuts-dialog.tsx to web/src/overrides: the shortcut
list on the same AdaptiveModalSheet as packages/app (search in the header). Same logic, DOM +
Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

MUTED_BASE = "text-sm leading-[normal] text-muted-foreground"

p = Port("components/keyboard-shortcuts-dialog.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet } from "react-native-unistyles";\n', "")
p.rep('''      <View testID="keyboard-shortcuts-dialog-content" style={styles.content}>
        {visibleSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
            <View style={styles.rows}>
              {section.rows.map((row) => (
                <View key={row.id} style={styles.row} testID={`shortcut-help-row-${row.id}`}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{t(row.labelKey)}</Text>
                    {row.note ? (
                      <Text style={styles.rowNote}>{row.noteKey ? t(row.noteKey) : row.note}</Text>
                    ) : null}
                  </View>
                  {row.chord === null ? (
                    <Text style={styles.rowUnassigned}>{t("settings.shortcuts.unassigned")}</Text>
                  ) : (
                    <Shortcut chord={row.chord} style={styles.rowShortcut} />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}
        {visibleSections.length === 0 ? (
          <Text style={styles.empty}>{t("common.empty.noResults")}</Text>
        ) : null}
      </View>''', f'''      <div data-testid="keyboard-shortcuts-dialog-content" className="flex flex-col gap-4">
        {{visibleSections.map((section) => (
          <div key={{section.title}} className="flex flex-col gap-2">
            <span className="text-xs leading-[normal] font-medium text-muted-foreground">
              {{t(section.titleKey)}}
            </span>
            <div className="flex flex-col overflow-hidden rounded-[10px] border border-muted">
              {{section.rows.map((row) => (
                <div
                  key={{row.id}}
                  className="flex flex-row items-center justify-between gap-3 border-b border-muted px-4 py-3"
                  data-testid={{`shortcut-help-row-${{row.id}}`}}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm leading-[normal] text-foreground">
                      {{t(row.labelKey)}}
                    </span>
                    {{row.note ? (
                      <span className="mt-0.5 text-xs leading-[normal] text-muted-foreground">
                        {{row.noteKey ? t(row.noteKey) : row.note}}
                      </span>
                    ) : null}}
                  </div>
                  {{row.chord === null ? (
                    <span className="self-start {MUTED_BASE}">
                      {{t("settings.shortcuts.unassigned")}}
                    </span>
                  ) : (
                    <span className="flex self-start">
                      <Shortcut chord={{row.chord}} />
                    </span>
                  )}}
                </div>
              ))}}
            </div>
          </div>
        ))}}
        {{visibleSections.length === 0 ? (
          <span className="block py-6 text-center {MUTED_BASE}">{{t("common.empty.noResults")}}</span>
        ) : null}}
      </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("every shortcut with its effective keys, searchable; DOM view.", "keyboard-shortcuts-dialog.py")
