// Port of packages/app/src/agent-skills/index.tsx: the BySpace skills card of a host's Agents page; DOM view.
// Converted from the Expo file by web/scripts/port/agent-skills.py (tag archive/expo-app); edit it directly.
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "@react-navigation/native";
import { withUnistyles } from "react-native-unistyles";
import { ArrowUpRight, Blocks, Check, Settings2 } from "lucide-react";
import type { AgentSkillOperation, AgentSkillsStatus } from "@bytetrue/protocol/messages";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostFeature } from "@/runtime/host-features";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openExternalUrl } from "@/utils/open-external-url";
import { SkillSelectionSheet } from "@/agent-skills/selection-sheet";
import { useAgentSkills } from "@/agent-skills/use-agent-skills";

const OP_KIND_ORDER: Record<AgentSkillOperation["kind"], number> = {
  add: 0,
  update: 1,
  delete: 2,
};
const ThemedBlocks = withUnistyles(Blocks);
const ThemedCheck = withUnistyles(Check);
const ThemedSettings = withUnistyles(Settings2);
const ThemedArrowUpRight = withUnistyles(ArrowUpRight);
const SKILLS_DOCS_URL = "https://github.com/ByteTrue/byspace/blob/main/public-docs/skills.md";
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function formatUpdateMessage(ops: readonly AgentSkillOperation[], t: TFunction): string {
  return [...ops]
    .sort((a, b) => OP_KIND_ORDER[a.kind] - OP_KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
    .map((op) => `${t(`settings.host.skills.operations.${op.kind}`)} ${op.name}`)
    .join("\n");
}

/** Pending deletions are the app's to apply, so they do not make the card read as stale. */
function visibleSkillsState(
  status: AgentSkillsStatus | null,
  maintenanceOps: readonly AgentSkillOperation[],
): AgentSkillsStatus["state"] | null {
  if (status?.state === "drift" && maintenanceOps.length === 0) return "up-to-date";
  return status?.state ?? null;
}

function hasSelectedSkill(status: AgentSkillsStatus | null): boolean {
  if (!status) return false;
  if (status.selection.mode === "all") return status.available.length > 0;
  return status.selection.skills.some((name) => status.available.includes(name));
}

export function AgentSkillsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  // Locations are a per-host capability: an older host keeps writing every home
  // and the picker shows no location rows rather than a switch that does nothing.
  const supportsTargets = useHostFeature(serverId, "skillInstallTargets");
  const skills = useAgentSkills(serverId);
  const refreshSkills = skills.refresh;
  const skillsConnected = skills.connected;
  const skillsSupported = skills.supported;
  const [isChoosing, setIsChoosing] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (skillsConnected && skillsSupported) void refreshSkills();
      return undefined;
    }, [refreshSkills, skillsConnected, skillsSupported]),
  );
  const maintenanceOps = useMemo(
    () => skills.status?.ops.filter((op) => op.kind !== "delete") ?? [],
    [skills.status?.ops],
  );
  const state = visibleSkillsState(skills.status, maintenanceOps);
  const hasSelected = hasSelectedSkill(skills.status);

  const handleReconcile = useCallback(async () => {
    if (skills.isWorking) return;
    const confirmed = await confirmDialog({
      title: t("settings.host.skills.updateTitle"),
      message:
        maintenanceOps.length > 0
          ? formatUpdateMessage(maintenanceOps, t)
          : t("settings.host.skills.updateFallback"),
      confirmLabel: t("settings.host.skills.actions.update"),
    });
    if (confirmed) await skills.reconcile();
  }, [maintenanceOps, skills, t]);
  // A first install is the moment the choice exists, and only one of the two
  // paths may write the agent homes. Ask, rather than installing the whole
  // bundle into every supported agent home because nobody was asked. A daemon
  // too old to send selectionSaved keeps its pre-existing behavior.
  const firstInstall = skills.status?.selectionSaved === false;
  const handleInstall = useCallback(() => {
    if (firstInstall) {
      setIsChoosing(true);
      return;
    }
    void skills.reconcile();
  }, [firstInstall, skills]);
  const handleUninstall = useCallback(async () => {
    if (skills.isWorking) return;
    const confirmed = await confirmDialog({
      title: t("settings.host.skills.uninstallTitle"),
      message: t("settings.host.skills.uninstallMessage"),
      confirmLabel: t("settings.host.skills.actions.uninstall"),
      destructive: true,
    });
    if (confirmed) await skills.uninstall();
  }, [skills, t]);
  const chooseIcon = useMemo(
    () => <ThemedSettings size={ICON_SIZE.sm} uniProps={mutedMapping} />,
    [],
  );
  const handleOpen = useCallback(() => setIsChoosing(true), []);
  const handleClose = useCallback(() => setIsChoosing(false), []);
  const handleOpenDocs = useCallback(() => {
    void openExternalUrl(SKILLS_DOCS_URL);
  }, []);
  const docsIcon = useMemo(
    () => <ThemedArrowUpRight size={ICON_SIZE.sm} uniProps={mutedMapping} />,
    [],
  );
  const trailing = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={docsIcon}
        className="gap-1 text-xs text-muted-foreground"
        onPress={handleOpenDocs}
        accessibilityLabel={t("settings.host.skills.openDocs")}
      >
        {t("settings.host.skills.docs")}
      </Button>
    ),
    [docsIcon, handleOpenDocs, t],
  );

  if (!skills.connected || !skills.supported) {
    return (
      <SettingsSection title={t("settings.host.skills.sectionTitle")} trailing={trailing}>
        <div className={settingsStyles.card} data-testid="host-agent-skills-unavailable">
          <div className="p-4">
            <span className="text-xs leading-[normal] text-muted-foreground">
              {skills.connected
                ? t("settings.host.skills.unsupported")
                : t("settings.host.skills.unavailable")}
            </span>
          </div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title={t("settings.host.skills.sectionTitle")} trailing={trailing}>
      <div className={settingsStyles.card} data-testid="host-agent-skills-card">
        <div className={settingsStyles.row}>
          <div className={settingsStyles.rowContent}>
            <div className="flex flex-row items-center gap-2">
              <ThemedBlocks size={ICON_SIZE.md} uniProps={foregroundMapping} />
              <span className={settingsStyles.rowTitle}>{t("settings.host.skills.title")}</span>
            </div>
            <span className={settingsStyles.rowHint}>
              {state === "drift"
                ? t("settings.host.skills.updateAvailable")
                : t("settings.host.skills.description")}
            </span>
          </div>
          <div className="flex flex-row items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={chooseIcon}
              onPress={handleOpen}
              disabled={skills.status === null || skills.isWorking}
              accessibilityLabel={t("settings.host.skills.choose")}
            >
              {isCompact ? null : t("settings.host.skills.choose")}
            </Button>
            {hasSelected ? (
              <SkillsActions
                state={state}
                isWorking={skills.isWorking}
                onInstall={handleInstall}
                onReconcile={handleReconcile}
                onUninstall={handleUninstall}
              />
            ) : null}
          </div>
        </div>
      </div>
      {skills.status ? (
        <SkillSelectionSheet
          visible={isChoosing}
          title={
            firstInstall ? t("settings.host.skills.chooseFirst") : t("settings.host.skills.choose")
          }
          confirmLabel={
            firstInstall
              ? t("settings.host.skills.actions.install")
              : t("settings.host.skills.actions.save")
          }
          available={skills.status.available}
          selection={skills.status.selection}
          targets={supportsTargets ? (skills.status.targets ?? null) : null}
          isSaving={skills.isWorking}
          onSave={skills.saveSelection}
          onClose={handleClose}
        />
      ) : null}
    </SettingsSection>
  );
}

function SkillsActions({
  state,
  isWorking,
  onReconcile,
  onInstall,
  onUninstall,
}: {
  state: AgentSkillsStatus["state"] | null;
  isWorking: boolean;
  onReconcile: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const { t } = useTranslation();
  if (state === "up-to-date") {
    return (
      <div className="flex flex-row items-center gap-2">
        <div className="flex flex-row items-center gap-1">
          <ThemedCheck size={14} uniProps={mutedMapping} />
          <span className="text-xs leading-[normal] text-muted-foreground">
            {t("settings.host.skills.actions.installed")}
          </span>
        </div>
        <Button variant="outline" size="sm" onPress={onUninstall} disabled={isWorking}>
          {t("settings.host.skills.actions.uninstall")}
        </Button>
      </div>
    );
  }
  if (state === "drift") {
    return (
      <div className="flex flex-row items-center gap-2">
        <Button variant="outline" size="sm" onPress={onReconcile} disabled={isWorking}>
          {isWorking
            ? t("settings.host.skills.actions.working")
            : t("settings.host.skills.actions.update")}
        </Button>
        <Button variant="outline" size="sm" onPress={onUninstall} disabled={isWorking}>
          {t("settings.host.skills.actions.uninstall")}
        </Button>
      </div>
    );
  }
  return (
    <Button variant="outline" size="sm" onPress={onInstall} disabled={isWorking}>
      {isWorking
        ? t("settings.host.skills.actions.installing")
        : t("settings.host.skills.actions.install")}
    </Button>
  );
}
