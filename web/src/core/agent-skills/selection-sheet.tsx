// Port of archive/expo-app:packages/app/src/agent-skills/selection-sheet.tsx: the skills picker sheet; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/agent-skills.py; edit it directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { confirmDialog } from "@/utils/confirm-dialog";
import type {
  AgentSkillSelection as SkillSelection,
  AgentSkillsSaveResult as SkillsSaveResult,
  AgentSkillsStatus,
  AgentSkillTargetId,
  AgentSkillTargets,
} from "@bytetrue/protocol/messages";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "~/components/ui/item";
import { Checkbox } from "~/components/ui/checkbox";

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
      <div className="flex flex-1 flex-row items-center justify-end gap-2">
        {saveError ? (
          <p className="mr-auto text-sm text-destructive" role="alert">
            {saveError}
          </p>
        ) : null}
        <Button variant="secondary" onClick={handleDismiss} disabled={isSaving}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          onClick={handleSave}
          data-testid="skill-selection-save"
          disabled={isSaving || noTargets}
        >
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          {isSaving ? t("settings.host.skills.actions.saving") : confirmLabel}
        </Button>
      </div>
    ),
    [confirmLabel, handleDismiss, handleSave, isSaving, noTargets, saveError, t],
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
      <ItemGroup data-testid="skill-selection-all-card">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{t("settings.host.skills.chooseAll")}</ItemTitle>
            <ItemDescription>{t("settings.host.skills.chooseAllHint")}</ItemDescription>
          </ItemContent>
          <Switch
            checked={allSkills}
            onCheckedChange={handleToggleAll}
            disabled={isSaving}
            aria-label={t("settings.host.skills.chooseAll")}
            data-testid="skill-selection-all"
          />
        </Item>
      </ItemGroup>

      {targets !== null ? (
        <SettingsSection title={t("settings.host.skills.targetsTitle")} flush>
          <ItemGroup data-testid="skill-selection-targets-card">
            {targets.available.map((id) => (
              <SkillTargetRow
                key={id}
                id={id}
                checked={draftTargets.includes(id)}
                disabled={isSaving}
                hint={t(`settings.host.skills.targets.${id}`)}
                onToggle={handleToggleTarget}
              />
            ))}
          </ItemGroup>
          {noTargets ? (
            <ItemDescription>{t("settings.host.skills.targetsEmpty")}</ItemDescription>
          ) : null}
        </SettingsSection>
      ) : null}

      {/* The sheet body already spaces its blocks apart, so the section owns
          only the gap between its label and the list the label names. */}
      <SettingsSection title={t("settings.host.skills.chooseList")} flush>
        <ItemGroup data-testid="skill-selection-list-card">
          {available.length === 0 ? (
            <Item variant="outline">
              <ItemDescription>{t("settings.host.skills.chooseEmpty")}</ItemDescription>
            </Item>
          ) : (
            available.map((name) => (
              <SkillCheckboxRow
                key={name}
                name={name}
                checked={isSkillSelected(draft, name)}
                disabled={allSkills || isSaving}
                onToggle={handleToggleSkill}
              />
            ))
          )}
        </ItemGroup>
      </SettingsSection>
    </AdaptiveModalSheet>
  );
}

interface SkillTargetRowProps {
  id: AgentSkillTargetId;
  checked: boolean;
  disabled: boolean;
  hint: string;
  onToggle: (id: AgentSkillTargetId) => void;
}

/** A location row: the label is the directory, so it needs no translation. */
function SkillTargetRow({ id, checked, disabled, hint, onToggle }: SkillTargetRowProps) {
  const handleToggle = useCallback(() => onToggle(id), [id, onToggle]);
  return (
    <Item variant="outline" asChild>
      <label>
        <Checkbox
          checked={checked}
          onCheckedChange={handleToggle}
          disabled={disabled}
          aria-label={SKILL_TARGET_DIRS[id]}
          aria-description={hint}
          data-testid={`skill-selection-target-${id}`}
        />
        <ItemContent>
          <ItemTitle>{SKILL_TARGET_DIRS[id]}</ItemTitle>
          <ItemDescription>{hint}</ItemDescription>
        </ItemContent>
      </label>
    </Item>
  );
}

interface SkillCheckboxRowProps {
  name: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (name: string) => void;
}

function SkillCheckboxRow({ name, checked, disabled, onToggle }: SkillCheckboxRowProps) {
  const handleToggle = useCallback(() => onToggle(name), [name, onToggle]);
  return (
    <Item variant="outline" asChild>
      <label>
        <Checkbox
          checked={checked}
          onCheckedChange={handleToggle}
          disabled={disabled}
          aria-label={name}
        />
        <ItemTitle>{name}</ItemTitle>
      </label>
    </Item>
  );
}
