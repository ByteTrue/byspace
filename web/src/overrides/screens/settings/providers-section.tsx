// Override of packages/app/src/screens/settings/providers-section.tsx: the provider list and the add-provider section; DOM view.
// Generated from the Expo file by web/scripts/port/providers-section.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { cn } from "cn";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import {
  buildAcpProviderConfigPatch,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { ProviderCatalogList } from "@/components/provider-catalog-list";
import { getProviderIcon } from "@/components/provider-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";

type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];

type StatusTone = "success" | "warning" | "danger" | "muted" | "loading";

interface ProviderStatus {
  tone: StatusTone;
  label: string;
  modelCount: number | null;
}

function getProviderStatus(
  status: string,
  enabled: boolean,
  modelCount: number,
  t: TFunction,
): ProviderStatus {
  if (!enabled)
    return { tone: "muted", label: t("settings.providers.statuses.disabled"), modelCount: null };
  if (status === "loading") {
    return { tone: "loading", label: t("settings.providers.statuses.loading"), modelCount: null };
  }
  if (status === "error") {
    return { tone: "danger", label: t("settings.providers.statuses.error"), modelCount: null };
  }
  if (status === "ready") {
    return {
      tone: "success",
      label: t("settings.providers.statuses.available"),
      modelCount: modelCount > 0 ? modelCount : null,
    };
  }
  return {
    tone: "warning",
    label: t("settings.providers.statuses.notInstalled"),
    modelCount: null,
  };
}

interface ProviderRowProps {
  serverId: string;
  def: ProviderDefinition;
  entry: ProviderEntry;
  enabled: boolean;
  isToggling: boolean;
  isRemoving: boolean;
  canRemove: boolean;
  isFirst: boolean;
  onPress: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
  onRemove: (providerId: string, providerLabel: string) => void;
}

// The row opens the provider's settings; its switch and menu must not.
function stopClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

const SECTION_SPACING = { marginBottom: 16 };
const ADD_PROVIDER_SPACING = { marginTop: 16 };

interface ProviderActionsMenuProps {
  providerId: string;
  providerLabel: string;
  isRemoving: boolean;
  iconSize: number;
  foregroundColor: string;
  foregroundMutedColor: string;
  dangerColor: string;
  onRemove: (providerId: string, providerLabel: string) => void;
}

function ProviderActionsMenu({
  providerId,
  providerLabel,
  isRemoving,
  iconSize,
  foregroundColor,
  foregroundMutedColor,
  dangerColor,
  onRemove,
}: ProviderActionsMenuProps) {
  const { t } = useTranslation();
  const handleRemove = useCallback(() => {
    onRemove(providerId, providerLabel);
  }, [onRemove, providerId, providerLabel]);
  const trashLeading = useMemo(() => <Trash2 size={16} color={dangerColor} />, [dangerColor]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isRemoving}
        className="flex size-8 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-(--surface-3) data-[state=open]:bg-muted"
        accessibilityLabel={t("settings.providers.actions.menu", { name: providerLabel })}
        testID={`provider-actions-${providerId}`}
      >
        {({ hovered, open }) => (
          <MoreHorizontal
            size={iconSize}
            color={hovered || open ? foregroundColor : foregroundMutedColor}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          destructive
          leading={trashLeading}
          onSelect={handleRemove}
          status={isRemoving ? "pending" : "idle"}
          pendingLabel={t("settings.providers.actions.removing")}
          testID={`provider-remove-${providerId}`}
        >
          {t("settings.providers.actions.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderRow({
  serverId,
  def,
  entry,
  enabled,
  isToggling,
  isRemoving,
  canRemove,
  isFirst,
  onPress,
  onToggleEnabled,
  onRemove,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const ProviderIcon = getProviderIcon(def.id, serverId);
  const providerError =
    enabled &&
    entry.status === "error" &&
    typeof entry.error === "string" &&
    entry.error.trim().length > 0
      ? entry.error.trim()
      : null;
  const modelCount = filterSelectableModels(entry.models ?? null)?.length ?? 0;
  const providerStatus = getProviderStatus(entry.status, enabled, modelCount, t);

  const handlePress = useCallback(() => {
    onPress(def.id);
  }, [def.id, onPress]);
  const handleToggleValueChange = useCallback(
    (value: boolean) => {
      onToggleEnabled(def.id, value);
    },
    [def.id, onToggleEnabled],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        settingsStyles.row,
        !isFirst && settingsStyles.rowBorder,
        "group/provider min-h-14 cursor-pointer gap-3 outline-none hover:bg-muted focus-visible:bg-muted active:bg-(--surface-3)",
      )}
      onClick={handlePress}
      aria-label={t("settings.providers.providerDetails", { name: def.label })}
    >
      <div className="flex flex-1 flex-row items-center gap-2">
        <ChevronRight
          size={theme.iconSize.sm}
          className="shrink-0 text-muted-foreground group-hover/provider:text-foreground"
        />
        <ProviderIcon size={theme.iconSize.md} color={theme.colors.foreground} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-row items-center gap-2">
            <span className={cn(settingsStyles.rowTitle, "truncate")}>{def.label}</span>
            {!isCompact ? (
              <span className="text-sm leading-[normal] text-muted-foreground">·</span>
            ) : null}
            <StatusIndicator status={providerStatus} compact={isCompact} />
          </div>
          {providerError && !isCompact ? (
            <span className="mt-1 line-clamp-3 text-xs leading-[normal] text-red-300">
              {providerError}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-row items-center gap-1" onClick={stopClickPropagation}>
        <Switch
          value={enabled}
          onValueChange={handleToggleValueChange}
          disabled={isToggling || isRemoving}
          accessibilityLabel={t("settings.providers.enableProvider", { name: def.label })}
        />
        <div className="size-8">
          {canRemove ? (
            <ProviderActionsMenu
              providerId={def.id}
              providerLabel={def.label}
              isRemoving={isRemoving}
              iconSize={theme.iconSize.sm}
              foregroundColor={theme.colors.foreground}
              foregroundMutedColor={theme.colors.foregroundMuted}
              dangerColor={theme.colors.statusDanger}
              onRemove={onRemove}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getDotColor(tone: StatusTone, theme: ReturnType<typeof useUnistyles>["theme"]): string {
  switch (tone) {
    case "success":
      return theme.colors.statusSuccess;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

function StatusIndicator({ status, compact }: { status: ProviderStatus; compact: boolean }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const dotStyle = useMemo(
    () => ({ backgroundColor: getDotColor(status.tone, theme) }),
    [status.tone, theme],
  );

  return (
    <div className="flex flex-row items-center gap-1.5">
      {status.tone === "loading" ? (
        <LoadingSpinner size={10} color={theme.colors.foregroundMuted} />
      ) : (
        <span className="size-2 shrink-0 rounded-full" style={dotStyle} />
      )}
      {!compact ? (
        <>
          <span className="text-sm leading-[normal] text-muted-foreground">{status.label}</span>
          {status.modelCount !== null ? (
            <>
              <span className="text-sm leading-[normal] text-muted-foreground">·</span>
              <span className="text-sm leading-[normal] text-muted-foreground">
                {status.modelCount === 1
                  ? t("settings.providers.models.one")
                  : t("settings.providers.models.many", { count: status.modelCount })}
              </span>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
}

/**
 * The provider list. Collapses when closed because it is the longest block on
 * the Agents page and the agent-configuration sections below it are what people
 * come here for; the collapsed summary keeps the count and the enabled state
 * legible so nothing is hidden that is worth seeing at a glance.
 */
export function ProvidersSection({ serverId }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsProviderRemoval = useHostFeature(serverId, "providerRemoval");
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const openProviderSettings = useProviderSettingsStore((state) => state.open);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [removingProviderId, setRemovingProviderId] = useState<string | null>(null);
  const removingProviderIdRef = useRef<string | null>(null);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const hasServer = serverId.length > 0;

  const enabledCount = useMemo(
    () =>
      providerDefinitions.filter((def) => {
        const entry = entries?.find((candidate) => candidate.provider === def.id);
        return entry && (entry.enabled ?? true);
      }).length,
    [providerDefinitions, entries],
  );
  const collapsedSummary =
    providerDefinitions.length > 0
      ? t("settings.providers.enabledSummary", {
          enabled: enabledCount,
          total: providerDefinitions.length,
        })
      : undefined;

  const handleOpenProviderSettings = useCallback(
    (providerId: string) => {
      openProviderSettings({ serverId, provider: providerId });
    },
    [openProviderSettings, serverId],
  );

  const handleToggleEnabled = useCallback(
    async (providerId: string, enabled: boolean) => {
      setPendingProviderId(providerId);
      try {
        await patchConfig({ providers: { [providerId]: { enabled } } });
      } catch (error) {
        Alert.alert(
          t("settings.providers.updateErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setPendingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig, t],
  );

  const handleRemoveProvider = useCallback(
    async (providerId: string, providerLabel: string) => {
      if (removingProviderIdRef.current) return;
      removingProviderIdRef.current = providerId;
      setRemovingProviderId(providerId);
      try {
        const confirmed = await confirmDialog({
          title: t("settings.providers.remove.confirmTitle", { name: providerLabel }),
          message: t("settings.providers.remove.confirmMessage"),
          confirmLabel: t("settings.providers.remove.confirm"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }

        await patchConfig({ removeProviders: [providerId] });
      } catch (error) {
        Alert.alert(
          t("settings.providers.remove.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (removingProviderIdRef.current === providerId) {
          removingProviderIdRef.current = null;
        }
        setRemovingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig, t],
  );

  return (
    <SettingsSection
      title={t("settings.providers.title")}
      testID="host-page-providers-card"
      style={SECTION_SPACING}
      collapsible
      collapsedSummary={collapsedSummary}
    >
      {!hasServer || !isConnected ? (
        <div className={cn(settingsStyles.card, "items-center p-4")}>
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("settings.providers.unavailable")}
          </span>
        </div>
      ) : null}
      {hasServer && isConnected && isLoading ? (
        <div className={cn(settingsStyles.card, "items-center p-4")}>
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("settings.providers.loading")}
          </span>
        </div>
      ) : null}
      {hasServer && isConnected && !isLoading && providerDefinitions.length > 0 ? (
        <div className={settingsStyles.card}>
          {providerDefinitions.map((def, index) => {
            const entry = entries?.find((candidate) => candidate.provider === def.id);
            if (!entry) return null;
            return (
              <ProviderRow
                key={def.id}
                serverId={serverId}
                def={def}
                entry={entry}
                enabled={entry.enabled ?? true}
                isToggling={pendingProviderId === def.id}
                isRemoving={removingProviderId === def.id}
                canRemove={supportsProviderRemoval && entry.source === "custom"}
                isFirst={index === 0}
                onPress={handleOpenProviderSettings}
                onToggleEnabled={handleToggleEnabled}
                onRemove={handleRemoveProvider}
              />
            );
          })}
        </div>
      ) : null}
    </SettingsSection>
  );
}

/**
 * The ACP provider catalog. Its own section, rendered last on the Agents page:
 * adding a provider is a once-per-install errand, so it must never take the top
 * of the page away from the provider list and the agent configuration below it.
 * Collapsed by default for the same reason.
 */
export function AddProviderSection({ serverId }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { refresh } = useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const [installingProviderId, setInstallingProviderId] = useState<string | null>(null);
  const hasServer = serverId.length > 0;

  const handleInstall = useCallback(
    async (entry: AcpProviderCatalogItem) => {
      if (installingProviderId) return;
      setInstallingProviderId(entry.id);
      try {
        await patchConfig(buildAcpProviderConfigPatch(entry));
        await refresh([entry.id]);
      } catch (error) {
        Alert.alert(
          t("settings.providers.addErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setInstallingProviderId((current) => (current === entry.id ? null : current));
      }
    },
    [installingProviderId, patchConfig, refresh, t],
  );

  if (!hasServer || !isConnected) {
    return null;
  }

  return (
    <SettingsSection
      title={t("settings.providers.addProvider")}
      testID="host-page-add-provider-card"
      style={ADD_PROVIDER_SPACING}
      collapsible
      defaultCollapsed
    >
      <ProviderCatalogList
        serverId={serverId}
        installingProviderId={installingProviderId}
        onInstall={handleInstall}
      />
    </SettingsSection>
  );
}
