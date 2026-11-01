"""Port packages/app's agent-profiles/settings/agent-profiles-section.tsx and agent-profile-row.tsx
to web/src/overrides: the agent profiles list of a host's Agents page. Same logic, DOM + Tailwind
view. Also adds the section back to the web agent-profiles barrel."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import OVR, Port  # noqa: E402

EMPTY_TEXT = "text-center text-sm leading-[normal] text-muted-foreground"

# ---- agent-profiles-section.tsx ----
p = Port("agent-profiles/settings/agent-profiles-section.tsx")
p.rep('import { Alert, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\n')
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
# an override's relative imports do not reach packages/app
p.rep('from "../internal/use-agent-profiles";', 'from "@/agent-profiles/internal/use-agent-profiles";')
p.rep('from "../internal/profile-id";', 'from "@/agent-profiles/internal/profile-id";')
p.rep('from "../internal/profile-form-model";', 'from "@/agent-profiles/internal/profile-form-model";')
p.rep('from "./agent-profile-edit-modal";', 'from "@/agent-profiles/settings/agent-profile-edit-modal";')
p.rep('from "./agent-profile-row";', 'from "@/agent-profiles/settings/agent-profile-row";')
p.rep('''        <View style={settingsStyles.card} testID="agent-profiles-unavailable">
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>''', f'''        <div className={{settingsStyles.card}} data-testid="agent-profiles-unavailable">
          <div className="flex flex-col items-center gap-3 px-4 py-6">
            <span className="{EMPTY_TEXT}">''')
p.rep('''                : t("settings.host.agentProfiles.unavailable")}
            </Text>
          </View>
        </View>''', '''                : t("settings.host.agentProfiles.unavailable")}
            </span>
          </div>
        </div>''')
p.rep('''            <View style={styles.emptyCard}>
              <Text style={styles.emptyText} testID="agent-profiles-empty">
                {t("settings.host.agentProfiles.emptyState")}
              </Text>''', f'''            <div className="flex flex-col items-center gap-3 px-4 py-6">
              <span className="{EMPTY_TEXT}" data-testid="agent-profiles-empty">
                {{t("settings.host.agentProfiles.emptyState")}}
              </span>''')
p.rep('''              </Button>
            </View>
          )}
        </View>''', '''              </Button>
            </div>
          )}
        </div>''')
p.rep('''        <View style={settingsStyles.card} testID="agent-profiles-card">''',
      '''        <div className={settingsStyles.card} data-testid="agent-profiles-card">''')
p.cut_from("const styles = StyleSheet.create")
p.check(allow=('react-native"',))
p.write("the agent profiles list of a host's Agents page; DOM view.", "agent-profiles-section.py")

# ---- agent-profile-row.tsx ----
MUTED_XS = "text-xs leading-[normal] text-muted-foreground"
p = Port("agent-profiles/settings/agent-profile-row.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\nimport { cn } from "cn";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('from "../internal/agent-profile-glyph";', 'from "@/agent-profiles/internal/agent-profile-glyph";')
p.rep('from "../internal/profile-summary";', 'from "@/agent-profiles/internal/profile-summary";')
p.rep('''  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );
''', "")
p.rep('''    <View style={rowStyle} testID={`agent-profile-row-${profile.id}`}>
      <View style={styles.rowMain}>
        <View style={styles.iconWrapper}>
          <AgentProfileGlyph icon={profile.icon} color={profile.color} size={ICON_SIZE.md} />
        </View>
        <View style={settingsStyles.rowContent}>
          <View style={styles.titleLine}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              {profile.name}
            </Text>
            <Text style={styles.summary} numberOfLines={1}>
              {summary}
            </Text>
          </View>
          {profile.notes ? (
            <View style={styles.notes}>
              <ThemedFileText size={ICON_SIZE.xs} uniProps={mutedColorMapping} />
              <Text
                style={styles.notesText}
                numberOfLines={2}
                testID={`agent-profile-notes-${profile.id}`}
              >
                {profile.notes}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.rowActions}>''', f'''    <div
      className={{cn(
        settingsStyles.row,
        !isFirst && settingsStyles.rowBorder,
        "min-h-14 items-center gap-2 py-3",
      )}}
      data-testid={{`agent-profile-row-${{profile.id}}`}}
    >
      <div className="flex flex-1 flex-row items-start gap-2">
        <div className="mt-px flex w-4 items-center justify-center">
          <AgentProfileGlyph icon={{profile.icon}} color={{profile.color}} size={{ICON_SIZE.md}} />
        </div>
        <div className={{settingsStyles.rowContent}}>
          <div className="flex min-w-0 flex-row items-baseline gap-2">
            <span className={{cn(settingsStyles.rowTitle, "truncate")}}>{{profile.name}}</span>
            <span className="shrink truncate {MUTED_XS}">{{summary}}</span>
          </div>
          {{profile.notes ? (
            <div className="mt-1 flex flex-row items-start gap-1">
              <ThemedFileText size={{ICON_SIZE.xs}} uniProps={{mutedColorMapping}} />
              <span
                className="line-clamp-2 flex-1 {MUTED_XS}"
                data-testid={{`agent-profile-notes-${{profile.id}}`}}
              >
                {{profile.notes}}
              </span>
            </div>
          ) : null}}
        </div>
      </div>
      <div className="flex flex-row items-center">''')
p.rep('''          testID={`agent-profile-remove-${profile.id}`}
        />
      </View>
    </View>''', '''          testID={`agent-profile-remove-${profile.id}`}
        />
      </div>
    </div>''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("one agent profile row; DOM view.", "agent-profiles-section.py")

# ---- the web barrel: the section is ported now ----
barrel = OVR / "agent-profiles/index.ts"
s = barrel.read_text(encoding="utf-8")
old = "// shortcut: without the settings section (step 4 ports settings).\n"
if old in s:
    s = s.replace(old, "")
    s = s.rstrip("\n") + '\nexport { AgentProfilesSection } from "@/agent-profiles/settings/agent-profiles-section";\n'
    barrel.write_text(s, encoding="utf-8")
    print("updated web/src/overrides/agent-profiles/index.ts")
