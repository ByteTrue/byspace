// Override of packages/app/src/agent-skills/selection-sheet.tsx: the skills picker sheet; DOM view.
// Generated from the Expo file by web/scripts/port/agent-skills.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { cn } from "cn";
import { Check } from "lucide-react";
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
  AgentSkillsStatus,
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

type AgentSkillTargetsStatus = NonNullable<AgentSkillsStatus["targets"]>;

const CHECK_ROW =
  "w-full justify-start gap-3 text-left outline-none focus-visible:bg-muted disabled:opacity-50";
const BOX = "flex size-4 shrink-0 items-center justify-center rounded-[4px] border";

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
      <div className="flex flex-1 flex-row justify-end gap-2">
        <Button variant="secondary" onPress={handleDismiss} disabled={isSaving}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          onPress={handleSave}
          loading={isSaving}
          disabled={noTargets}
          testID="skill-selection-save"
        >
          {isSaving ? t("settings.host.skills.actions.saving") : confirmLabel}
        </Button>
      </div>
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
      <div className={settingsStyles.card} data-testid="skill-selection-all-card">
        <div className={settingsStyles.row}>
          <div className={settingsStyles.rowContent}>
            <span className={settingsStyles.rowTitle}>{t("settings.host.skills.chooseAll")}</span>
            <span className={settingsStyles.rowHint}>
              {t("settings.host.skills.chooseAllHint")}
            </span>
          </div>
          <Switch
            value={allSkills}
            onValueChange={handleToggleAll}
            disabled={isSaving}
            accessibilityLabel={t("settings.host.skills.chooseAll")}
            testID="skill-selection-all"
          />
        </div>
      </div>

      {targets !== null ? (
        <SettingsSection title={t("settings.host.skills.targetsTitle")} flush>
          <div className={settingsStyles.card} data-testid="skill-selection-targets-card">
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
          </div>
          {noTargets ? (
            <span className={settingsStyles.rowHint}>{t("settings.host.skills.targetsEmpty")}</span>
          ) : null}
        </SettingsSection>
      ) : null}

      {/* The sheet body already spaces its blocks apart, so the section owns
          only the gap between its label and the list the label names. */}
      <SettingsSection title={t("settings.host.skills.chooseList")} flush>
        <div className={settingsStyles.card} data-testid="skill-selection-list-card">
          {available.length === 0 ? (
            <div className={settingsStyles.row}>
              <span className={settingsStyles.rowHint}>
                {t("settings.host.skills.chooseEmpty")}
              </span>
            </div>
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
        </div>
      </SettingsSection>

      {saveError ? <span className={settingsStyles.rowError}>{saveError}</span> : null}
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
  const rowClassName = cn(settingsStyles.row, withBorder && settingsStyles.rowBorder, CHECK_ROW);
  // shadcn/ui checkbox: 16px, 4px radius, input border; checked fills with the primary.
  const boxClassName = cn(
    BOX,
    checked ? "border-primary bg-primary" : "border-input bg-background dark:bg-input/30",
  );

  return (
    <button
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
    </button>
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
  const rowClassName = cn(settingsStyles.row, withBorder && settingsStyles.rowBorder, CHECK_ROW);
  // shadcn/ui checkbox: 16px, 4px radius, input border; checked fills with the primary.
  const boxClassName = cn(
    BOX,
    checked ? "border-primary bg-primary" : "border-input bg-background dark:bg-input/30",
  );

  return (
    <button
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
    </button>
  );
}
