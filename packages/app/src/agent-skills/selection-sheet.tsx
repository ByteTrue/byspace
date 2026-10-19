import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import type {
  AgentSkillSelection as SkillSelection,
  AgentSkillsSaveResult as SkillsSaveResult,
  AgentSkillTargetId,
  AgentSkillTargets,
} from "@bytetrue/protocol/messages";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

interface SkillSelectionSheetProps {
  visible: boolean;
  /** Names the outcome: a first install is not the same action as editing one. */
  title: string;
  /** Likewise for the primary button: it installs on a first run, and saves after. */
  confirmLabel: string;
  available: readonly string[];
  selection: SkillSelection;
  /** Null when the host predates target selection: the rows are then hidden. */
  targets: AgentSkillTargetsStatus | null;
  isSaving: boolean;
  onSave: (
    selection: SkillSelection,
    /** Absent when the host predates install targets, which keeps its stored ones. */
    targets: AgentSkillTargets | undefined,
    confirmedRemovals?: readonly string[],
  ) => Promise<SkillsSaveResult>;
  onClose: () => void;
}

interface AgentSkillTargetsStatus {
  available: readonly AgentSkillTargetId[];
  selected: readonly AgentSkillTargetId[];
}

function isSkillSelected(draft: SkillSelection, name: string): boolean {
  return draft.mode === "all" || draft.skills.includes(name);
}

/** Target labels are paths, so they read as locations rather than as names. */
const SKILL_TARGET_DIRS: Record<AgentSkillTargetId, string> = {
  agents: "~/.agents/skills",
  claude: "~/.claude/skills",
};

function toggleTarget(
  draft: readonly AgentSkillTargetId[],
  id: AgentSkillTargetId,
): AgentSkillTargetId[] {
  return draft.includes(id) ? draft.filter((entry) => entry !== id) : [...draft, id];
}

/**
 * Draft form state only. The saved selection, the convergence across agent skill
 * directories, and the resulting status all belong to the selected host.
 */
export function SkillSelectionSheet({
  visible,
  title,
  confirmLabel,
  available,
  selection,
  targets,
  isSaving,
  onSave,
  onClose,
}: SkillSelectionSheetProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SkillSelection>(selection);
  const [draftTargets, setDraftTargets] = useState<AgentSkillTargetId[]>([
    ...(targets?.selected ?? []),
  ]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const wasVisible = useRef(visible);

  // Seeded when the sheet opens, not whenever a background status refresh hands
  // back a new selection object — that would throw away edits in progress.
  useEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!opening) return;
    setDraft(selection);
    setDraftTargets([...(targets?.selected ?? [])]);
    setSaveError(null);
  }, [selection, targets, visible]);

  const handleToggleAll = useCallback(
    (nextAll: boolean) => {
      // Leaving `all` keeps every currently installed skill checked, so turning
      // the switch off is a starting point rather than a reset.
      setDraft(nextAll ? { mode: "all" } : { mode: "custom", skills: [...available] });
    },
    [available],
  );

  const handleToggleSkill = useCallback((name: string) => {
    setDraft((current) => {
      if (current.mode === "all") return current;
      const skills = current.skills.includes(name)
        ? current.skills.filter((skill) => skill !== name)
        : [...current.skills, name].sort();
      return { mode: "custom", skills };
    });
  }, []);

  const handleToggleTarget = useCallback((id: AgentSkillTargetId) => {
    setDraftTargets((current) => toggleTarget(current, id));
  }, []);

  const handleSave = useCallback(() => {
    void (async () => {
      setSaveError(null);
      try {
        // The host refuses a save that would delete directories it was not told
        // about, and answers with the names it found when it looked. Asking it
        // is the only way the question and the deletion cannot drift apart.
        const attempt = await onSave(draft, targets === null ? undefined : draftTargets);
        if (attempt.confirmationRequired) {
          const confirmed = await confirmDialog({
            title: t("settings.host.skills.removeTitle"),
            message: t("settings.host.skills.removeMessage", {
              skills: attempt.confirmationRequired.removals.join(", "),
            }),
            confirmLabel: t("settings.host.skills.actions.remove"),
            destructive: true,
          });
          if (!confirmed) return;
          const retry = await onSave(
            draft,
            targets === null ? undefined : draftTargets,
            attempt.confirmationRequired.removals,
          );
          // Something else changed the directories again while the dialog was
          // up. Ask about the new list rather than deleting it unannounced.
          if (retry.confirmationRequired) {
            setSaveError(t("settings.host.skills.saveFailed"));
            return;
          }
        }
        onClose();
      } catch {
        setSaveError(t("settings.host.skills.saveFailed"));
      }
    })();
  }, [draft, draftTargets, onClose, onSave, t, targets]);

  const handleDismiss = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  // Turning off every home installs nothing, so Save would silently become
  // "uninstall and keep the preference". Block it and say why instead.
  const noTargets = targets !== null && draftTargets.length === 0;

  const header = useMemo<SheetHeader>(() => ({ title }), [title]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={handleDismiss}
          disabled={isSaving}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSave}
          loading={isSaving}
          disabled={noTargets}
          testID="skill-selection-save"
        >
          {isSaving ? t("settings.host.skills.actions.saving") : confirmLabel}
        </Button>
      </View>
    ),
    [confirmLabel, handleDismiss, handleSave, isSaving, noTargets, t],
  );

  const allSkills = draft.mode === "all";

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleDismiss}
      footer={footer}
      testID="skill-selection-sheet"
    >
      <View style={settingsStyles.card} testID="skill-selection-all-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.host.skills.chooseAll")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.host.skills.chooseAllHint")}</Text>
          </View>
          <Switch
            value={allSkills}
            onValueChange={handleToggleAll}
            disabled={isSaving}
            accessibilityLabel={t("settings.host.skills.chooseAll")}
            testID="skill-selection-all"
          />
        </View>
      </View>

      {targets !== null ? (
        <SettingsSection title={t("settings.host.skills.targetsTitle")} flush>
          <View style={settingsStyles.card} testID="skill-selection-targets-card">
            {targets.available.map((id, index) => (
              <SkillTargetRow
                key={id}
                id={id}
                checked={draftTargets.includes(id)}
                disabled={isSaving}
                withBorder={index > 0}
                hint={t(`settings.host.skills.targets.${id}`)}
                onToggle={handleToggleTarget}
              />
            ))}
          </View>
          {noTargets ? (
            <Text style={settingsStyles.rowHint}>{t("settings.host.skills.targetsEmpty")}</Text>
          ) : null}
        </SettingsSection>
      ) : null}

      {/* The sheet body already spaces its blocks apart, so the section owns
          only the gap between its label and the list the label names. */}
      <SettingsSection title={t("settings.host.skills.chooseList")} flush>
        <View style={settingsStyles.card} testID="skill-selection-list-card">
          {available.length === 0 ? (
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowHint}>{t("settings.host.skills.chooseEmpty")}</Text>
            </View>
          ) : (
            available.map((name, index) => (
              <SkillCheckboxRow
                key={name}
                name={name}
                checked={isSkillSelected(draft, name)}
                disabled={allSkills || isSaving}
                withBorder={index > 0}
                onToggle={handleToggleSkill}
              />
            ))
          )}
        </View>
      </SettingsSection>

      {saveError ? <Text style={settingsStyles.rowError}>{saveError}</Text> : null}
    </AdaptiveModalSheet>
  );
}

interface SkillTargetRowProps {
  id: AgentSkillTargetId;
  checked: boolean;
  disabled: boolean;
  withBorder: boolean;
  hint: string;
  onToggle: (id: AgentSkillTargetId) => void;
}

/** A location row: the label is the directory, so it needs no translation. */
function SkillTargetRow({
  id,
  checked,
  disabled,
  withBorder,
  hint,
  onToggle,
}: SkillTargetRowProps) {
  const handlePress = useCallback(() => onToggle(id), [id, onToggle]);
  const rowStyle = useMemo(
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

  return (
    <Pressable
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
        {checked ? <ThemedCheck size={14} uniProps={checkedIconMapping} /> : null}
      </View>
      <View style={styles.targetText}>
        <Text style={settingsStyles.rowTitle}>{SKILL_TARGET_DIRS[id]}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

interface SkillCheckboxRowProps {
  name: string;
  checked: boolean;
  disabled: boolean;
  withBorder: boolean;
  onToggle: (name: string) => void;
}

function SkillCheckboxRow({
  name,
  checked,
  disabled,
  withBorder,
  onToggle,
}: SkillCheckboxRowProps) {
  const handlePress = useCallback(() => onToggle(name), [name, onToggle]);
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const rowStyle = useMemo(
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

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={accessibilityState}
      aria-checked={checked}
    >
      <View style={boxStyle}>
        {checked ? <ThemedCheck size={14} uniProps={checkedIconMapping} /> : null}
      </View>
      <Text style={settingsStyles.rowTitle}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  checkboxRow: {
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  targetText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  disabledRow: {
    opacity: theme.opacity[50],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
}));
