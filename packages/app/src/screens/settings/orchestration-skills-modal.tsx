import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  OrchestrationSkillItemState,
  OrchestrationSkillTargetKind,
} from "@bytetrue/byspace-protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert as InlineAlert } from "@/components/ui/alert";

const ALL_SKILL_NAMES = [
  "byspace",
  "byspace-advisor",
  "byspace-committee",
  "byspace-handoff",
  "byspace-project-setup",
] as const;

interface TargetOptionRowProps {
  target: OrchestrationSkillTargetKind;
  title: string;
  hint: string;
  selected: boolean;
  onToggle: (target: OrchestrationSkillTargetKind) => void;
}

function TargetOptionRow({ target, title, hint, selected, onToggle }: TargetOptionRowProps) {
  const handlePress = useCallback(() => onToggle(target), [onToggle, target]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);

  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch value={selected} onValueChange={handlePress} />
    </Pressable>
  );
}

interface SkillOptionRowProps {
  name: string;
  description: string;
  selected: boolean;
  onToggle: (name: string) => void;
}

function SkillOptionRow({ name, description, selected, onToggle }: SkillOptionRowProps) {
  const handlePress = useCallback(() => onToggle(name), [name, onToggle]);
  const accessibilityState = useMemo(() => ({ checked: selected }), [selected]);

  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      testID={`skill-row-${name}`}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{name}</Text>
        {description ? <Text style={styles.rowHint}>{description}</Text> : null}
      </View>
      <Switch value={selected} onValueChange={handlePress} />
    </Pressable>
  );
}

export interface OrchestrationSkillsModalProps {
  visible: boolean;
  onClose: () => void;
  skills?: OrchestrationSkillItemState[];
  installedTargets?: OrchestrationSkillTargetKind[];
  onSave: (options: {
    skillNames: string[];
    targets: OrchestrationSkillTargetKind[];
  }) => Promise<void>;
  isSaving: boolean;
}

export function OrchestrationSkillsModal({
  visible,
  onClose,
  skills,
  installedTargets,
  onSave,
  isSaving,
}: OrchestrationSkillsModalProps) {
  const { t } = useTranslation();
  const [selectedTargets, setSelectedTargets] = useState<Set<OrchestrationSkillTargetKind>>(
    () => new Set<OrchestrationSkillTargetKind>(["agents", "claude"]),
  );
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(
    () => new Set<string>(ALL_SKILL_NAMES),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (!visible) {
      setErrorMessage(null);
      return;
    }
    setErrorMessage(null);

    // Initial targets selection
    if (installedTargets && installedTargets.length > 0) {
      setSelectedTargets(new Set<OrchestrationSkillTargetKind>(installedTargets));
    } else {
      setSelectedTargets(new Set<OrchestrationSkillTargetKind>(["agents", "claude"]));
    }

    // Initial skills selection
    if (skills && skills.some((s) => s.state !== "not-installed")) {
      const installed = skills.filter((s) => s.state !== "not-installed").map((s) => s.name);
      setSelectedSkills(new Set<string>(installed.length > 0 ? installed : ALL_SKILL_NAMES));
    } else {
      setSelectedSkills(new Set<string>(ALL_SKILL_NAMES));
    }
  }, [visible, skills, installedTargets]);

  const sheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.orchestration.skills.modalTitle") }),
    [t],
  );

  const toggleTarget = useCallback((target: OrchestrationSkillTargetKind) => {
    setSelectedTargets((current) => {
      const next = new Set(current);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  }, []);

  const toggleSkill = useCallback((skillName: string) => {
    setSelectedSkills((current) => {
      const next = new Set(current);
      if (next.has(skillName)) {
        next.delete(skillName);
      } else {
        next.add(skillName);
      }
      return next;
    });
  }, []);

  const handleToggleAllSkills = useCallback(() => {
    setSelectedSkills((current) => {
      if (current.size === ALL_SKILL_NAMES.length) {
        return new Set<string>();
      }
      return new Set<string>(ALL_SKILL_NAMES);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setErrorMessage(null);
    try {
      await onSave({
        skillNames: Array.from(selectedSkills),
        targets: Array.from(selectedTargets),
      });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("common.errors.unableToSave"));
    }
  }, [isSaving, onClose, onSave, selectedSkills, selectedTargets, t]);

  const allSkillsSelected = selectedSkills.size === ALL_SKILL_NAMES.length;
  const saveButtonLabel = useMemo(() => {
    if (isSaving) return t("settings.host.orchestration.skills.saving");
    return t("common.actions.save");
  }, [isSaving, t]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={onClose}
      testID="orchestration-skills-modal"
      desktopMaxWidth={520}
    >
      <View style={styles.body}>
        {/* Section: Targets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("settings.host.orchestration.skills.targetsTitle")}
          </Text>
          <View style={styles.card}>
            <TargetOptionRow
              target="agents"
              title={t("settings.host.orchestration.skills.targetAgents")}
              hint={t("settings.host.orchestration.skills.targetAgentsDesc")}
              selected={selectedTargets.has("agents")}
              onToggle={toggleTarget}
            />

            <View style={styles.rowDivider} />

            <TargetOptionRow
              target="claude"
              title={t("settings.host.orchestration.skills.targetClaude")}
              hint={t("settings.host.orchestration.skills.targetClaudeDesc")}
              selected={selectedTargets.has("claude")}
              onToggle={toggleTarget}
            />
          </View>
        </View>

        {/* Section: Skills */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              {t("settings.host.orchestration.skills.skillsTitle")}
            </Text>
            <Button
              variant="ghost"
              size="xs"
              onPress={handleToggleAllSkills}
              testID="toggle-all-skills-button"
            >
              {allSkillsSelected
                ? t("settings.host.orchestration.skills.deselectAll")
                : t("settings.host.orchestration.skills.selectAll")}
            </Button>
          </View>

          <View style={styles.card}>
            {ALL_SKILL_NAMES.map((skillName, index) => {
              const skillItem = skills?.find((s) => s.name === skillName);
              const desc = t(`settings.host.orchestration.skills.descriptions.${skillName}`, {
                defaultValue: skillItem?.description ?? "",
              });

              return (
                <View key={skillName}>
                  {index > 0 ? <View style={styles.rowDivider} /> : null}
                  <SkillOptionRow
                    name={skillName}
                    description={desc}
                    selected={selectedSkills.has(skillName)}
                    onToggle={toggleSkill}
                  />
                </View>
              );
            })}
          </View>
        </View>

        {errorMessage ? <InlineAlert variant="error" description={errorMessage} /> : null}

        {/* Footer actions */}
        <View style={styles.footer}>
          <Button variant="ghost" size="sm" onPress={onClose} disabled={isSaving}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={isSaving}
            testID="orchestration-skills-save-btn"
          >
            {saveButtonLabel}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[3],
  },
  rowContent: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  rowDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing[2],
  },
}));
