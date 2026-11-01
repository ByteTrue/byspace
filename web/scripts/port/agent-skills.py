"""Port packages/app's agent-skills/index.tsx and agent-skills/selection-sheet.tsx to
web/src/overrides: the BySpace skills card of a host's Agents page and the sheet that picks which
skills install where. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

MUTED_XS = "text-xs leading-[normal] text-muted-foreground"

# ---- agent-skills/index.tsx ----
p = Port("agent-skills/index.tsx")
p.rep('import { Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
# an override's relative imports do not reach packages/app
p.rep('import { SkillSelectionSheet } from "./selection-sheet";\n',
      'import { SkillSelectionSheet } from "@/agent-skills/selection-sheet";\n')
p.rep('import { useAgentSkills } from "./use-agent-skills";\n',
      'import { useAgentSkills } from "@/agent-skills/use-agent-skills";\n')
p.rep('''        textStyle={settingsStyles.sectionHeaderLinkText}
        style={settingsStyles.sectionHeaderLink}''', '''        className="gap-1 text-xs text-muted-foreground"''')
p.rep('''        <View style={settingsStyles.card} testID="host-agent-skills-unavailable">
          <View style={styles.emptyCard}>
            <Text style={styles.mutedText}>''', f'''        <div className={{settingsStyles.card}} data-testid="host-agent-skills-unavailable">
          <div className="p-4">
            <span className="{MUTED_XS}">''')
p.rep('''                : t("settings.host.skills.unavailable")}
            </Text>
          </View>
        </View>''', '''                : t("settings.host.skills.unavailable")}
            </span>
          </div>
        </div>''')
p.rep('''            <View style={styles.rowTitleRow}>''', '''            <div className="flex flex-row items-center gap-2">''')
p.rep('''          <View style={styles.actionsRow}>
            <Button
              variant="ghost"''', '''          <div className="flex flex-row items-center gap-2">
            <Button
              variant="ghost"''')
p.rep('''      <View style={styles.actionsRow}>
        <View style={styles.installedLabel}>
          <ThemedCheck size={14} uniProps={mutedMapping} />
          <Text style={styles.mutedText}>{t("settings.host.skills.actions.installed")}</Text>
        </View>''', f'''      <div className="flex flex-row items-center gap-2">
        <div className="flex flex-row items-center gap-1">
          <ThemedCheck size={{14}} uniProps={{mutedMapping}} />
          <span className="{MUTED_XS}">{{t("settings.host.skills.actions.installed")}}</span>
        </div>''')
p.rep('''      <View style={styles.actionsRow}>
        <Button variant="outline" size="sm" onPress={onReconcile} disabled={isWorking}>''',
      '''      <div className="flex flex-row items-center gap-2">
        <Button variant="outline" size="sm" onPress={onReconcile} disabled={isWorking}>''')
p.dom_tags()
p.dom_attrs()
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the BySpace skills card of a host's Agents page; DOM view.", "agent-skills.py")

# ---- agent-skills/selection-sheet.tsx ----
CHECK_ROW = (
    "w-full justify-start gap-3 text-left disabled:opacity-50"
)
BOX = "flex size-4 shrink-0 items-center justify-center rounded-[4px] border"
p = Port("agent-skills/selection-sheet.tsx")
p.rep('import { Pressable, Text, View } from "react-native";\n', "")
p.rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n',
      'import { withUnistyles } from "react-native-unistyles";\nimport { cn } from "cn";\n')
p.rep('from "lucide-react-native";', 'from "lucide-react";')
p.rep('''      <View style={styles.footer}>''', '''      <div className="flex flex-1 flex-row justify-end gap-2">''')
p.rep('''        </Button>
      </View>
    ),
    [confirmLabel''', '''        </Button>
      </div>
    ),
    [confirmLabel''')
p.rep('''            <Text style={settingsStyles.rowHint}>{t("settings.host.skills.targetsEmpty")}</Text>''',
      '''            <span className={settingsStyles.rowHint}>{t("settings.host.skills.targetsEmpty")}</span>''')
p.rep('''      {saveError ? <Text style={settingsStyles.rowError}>{saveError}</Text> : null}''',
      '''      {saveError ? <span className={settingsStyles.rowError}>{saveError}</span> : null}''')
# both checkbox rows: a button with the checkbox role
for kind in ("target", "skill"):
    p.rep('''  const rowStyle = useMemo(
    () => [
      settingsStyles.row,
      withBorder ? settingsStyles.rowBorder : null,
      styles.checkboxRow,
      disabled ? styles.disabledRow : null,
    ],
    [disabled, withBorder],
  );
  const boxStyle = useMemo(
    () => [styles.checkbox, checked ? styles.checkboxChecked : null],
    [checked],
  );
''' if kind == "skill" else '''  const rowStyle = useMemo(
    () => [
      settingsStyles.row,
      withBorder ? settingsStyles.rowBorder : null,
      styles.checkboxRow,
      disabled ? styles.disabledRow : null,
    ],
    [disabled, withBorder],
  );
  const boxStyle = useMemo(
    () => [styles.checkbox, checked ? styles.checkboxChecked : null],
    [checked],
  );
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
''', '''  const rowClassName = cn(settingsStyles.row, withBorder && settingsStyles.rowBorder, CHECK_ROW);
  // shadcn/ui checkbox: 16px, 4px radius, input border; checked fills with the primary.
  const boxClassName = cn(
    BOX,
    checked ? "border-primary bg-primary" : "border-input bg-background dark:bg-input/30",
  );
''')
p.rep('''  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const rowClassName''', '''  const rowClassName''')
p.rep('''    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={SKILL_TARGET_DIRS[id]}
      accessibilityHint={hint}
      accessibilityState={accessibilityState}
      aria-checked={checked}
      testID={`skill-selection-target-${id}`}
    >
      <View style={boxStyle}>
        {checked ? <ThemedCheck size={12} strokeWidth={3} uniProps={checkedIconMapping} /> : null}
      </View>
      <View style={styles.targetText}>
        <Text style={settingsStyles.rowTitle}>{SKILL_TARGET_DIRS[id]}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
    </Pressable>''', '''    <button
      type="button"
      role="checkbox"
      className={rowClassName}
      onClick={handlePress}
      disabled={disabled}
      aria-label={SKILL_TARGET_DIRS[id]}
      aria-description={hint}
      aria-checked={checked}
      data-testid={`skill-selection-target-${id}`}
    >
      <span className={boxClassName}>
        {checked ? <ThemedCheck size={12} strokeWidth={3} uniProps={checkedIconMapping} /> : null}
      </span>
      <span className="flex flex-1 flex-col gap-1">
        <span className={settingsStyles.rowTitle}>{SKILL_TARGET_DIRS[id]}</span>
        <span className={settingsStyles.rowHint}>{hint}</span>
      </span>
    </button>''')
p.rep('''    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={accessibilityState}
      aria-checked={checked}
    >
      <View style={boxStyle}>
        {checked ? <ThemedCheck size={12} strokeWidth={3} uniProps={checkedIconMapping} /> : null}
      </View>
      <Text style={settingsStyles.rowTitle}>{name}</Text>
    </Pressable>''', '''    <button
      type="button"
      role="checkbox"
      className={rowClassName}
      onClick={handlePress}
      disabled={disabled}
      aria-label={name}
      aria-checked={checked}
    >
      <span className={boxClassName}>
        {checked ? <ThemedCheck size={12} strokeWidth={3} uniProps={checkedIconMapping} /> : null}
      </span>
      <span className={settingsStyles.rowTitle}>{name}</span>
    </button>''')
p.rep('''type AgentSkillTargetsStatus = NonNullable<AgentSkillsStatus["targets"]>;''',
      f'''type AgentSkillTargetsStatus = NonNullable<AgentSkillsStatus["targets"]>;

const CHECK_ROW =
  "{CHECK_ROW}";
const BOX = "{BOX}";''')
p.dom_tags()
p.dom_attrs()
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the skills picker sheet; DOM view.", "agent-skills.py")
