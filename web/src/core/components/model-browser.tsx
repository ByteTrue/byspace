// Port of archive/expo-app:packages/app/src/components/model-browser.tsx: the model picker's body — pinned agent
// profiles, providers to drill into, a provider's models, search across all of them, and the
// loading, error and no-match states. `useModelBrowser` is the Expo file's state model.
import { Separator } from "~/components/ui/separator";
import {
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronRight, Pencil, Plus, Search, Settings } from "lucide-react";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import {
  AgentProfileGlyph,
  type AgentProfilePicker,
  type AgentProfilePickerRow as AgentProfilePickerRowModel,
  type AgentProfileSeed,
} from "@/agent-profiles";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { getProviderIcon } from "@/components/provider-icons";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  buildProviderQualifiedDescription,
  buildSelectedTriggerLabel,
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  resolveSelectedModelLabel,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { useCurrentOverlayLayer } from "@/lib/overlay-root";
import { ICON_SIZE } from "@/styles/theme";
import {
  groupProfilesByProviderModel,
  resolveInitialModelBrowserView,
  resolveModelBrowserAllView,
  type ModelBrowserView,
} from "@/components/model-browser-view";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";
import { Item } from "~/components/ui/item";

const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
const DESKTOP_MODEL_ROW_HEIGHT = 40;

const ICON_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-accent active:bg-muted";
/** The Expo app's web rows: 12px in a popover and in a phone sheet alike (24px is its native inset). */
const ROW_INSET = "px-3";

function ProviderSettingsAction({
  accessibilityLabel,
  provider,
  serverId,
}: {
  accessibilityLabel: string;
  provider: string;
  serverId: string | null;
}) {
  const overlayParentLayer = useCurrentOverlayLayer();
  const handlePress = useCallback(() => {
    if (!serverId) return;
    useProviderSettingsStore.getState().open({ serverId, provider, overlayParentLayer });
  }, [overlayParentLayer, provider, serverId]);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      onClick={handlePress}
      disabled={!serverId}
      aria-label={accessibilityLabel}
      data-testid={`selector-header-settings-${provider}`}
    >
      <Settings size={ICON_SIZE.sm} />
    </Button>
  );
}

function AgentProfilesEditAction({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          onClick={onPress}
          aria-label={t("modelSelector.editProfilesLabel")}
          data-testid="model-profiles-edit"
        >
          <Pencil size={ICON_SIZE.xs} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {t("modelSelector.editProfilesLabel")}
      </TooltipContent>
    </Tooltip>
  );
}

interface ModelBrowserInput {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  isLoading: boolean;
  autoFocusSearch?: boolean;
  /** Pinned above the provider list on the root view. `null` hides the section. */
  profiles?: AgentProfilePicker | null;
  serverId?: string | null;
}

export interface ModelBrowserState {
  serverId: string | null;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  profiles: AgentProfilePicker | null;
  view: ModelBrowserView;
  searchQuery: string;
  isSearchFocused: boolean;
  header: SheetHeader;
  selectedModelLabel: string;
  triggerLabel: string;
  desktopFixedHeight: number | undefined;
  isProviderView: boolean;
  prepareToOpen: () => void;
  showAll: () => void;
  reset: () => void;
  drillDown: (providerId: string, providerLabel: string) => void;
}

interface ModelBrowserProps {
  state: ModelBrowserState;
  onSelect: (provider: string, modelId: string) => void;
  /** Applying a profile resolves the pick and dismisses, exactly like a model row. */
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  scrolling?: "sheet" | "independent";
  /** Empty focused search shows all model rows instead of the browse root. */
  searchAllOnFocus?: boolean;
  /** Replaces provider rows only while the all-provider search is empty. */
  rootBrowseContent?: ReactNode;
  /** Hide the pinned Profiles section while still using rows for model matching. */
  showProfilesSection?: boolean;
}

interface ModelBrowserContentProps extends Omit<ModelBrowserProps, "state" | "scrolling"> {
  serverId: string | null;
  view: ModelBrowserView;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  searchQuery: string;
  isSearchFocused: boolean;
  profiles: AgentProfilePicker | null;
  onDrillDown: (providerId: string, providerLabel: string) => void;
  scrolling: "sheet" | "independent";
  searchAllOnFocus: boolean;
  rootBrowseContent?: ReactNode;
}

export function ModelProviderGlyph({
  provider,
  serverId,
  size,
  tone = "muted",
}: {
  provider: string;
  serverId: string | null;
  size: number;
  tone?: "muted" | "foreground";
}) {
  const Icon = getProviderIcon(provider, serverId);
  return (
    <span
      className={cn("flex", tone === "foreground" ? "text-foreground" : "text-muted-foreground")}
    >
      <Icon size={size} color="currentColor" />
    </span>
  );
}

function countModelsInView(view: ModelBrowserView, providers: ProviderSelectorProvider[]): number {
  if (view.kind === "all") return getAllProviderModelRows(providers).length;
  const provider = providers.find((entry) => entry.id === view.providerId);
  return provider?.modelSelection.kind === "models" ? getProviderModelRows(provider).length : 0;
}

function resolveDesktopFixedHeight(
  view: ModelBrowserView,
  providers: ProviderSelectorProvider[],
): number {
  const modelCount = countModelsInView(view, providers);
  return Math.min(
    Math.max(
      DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
      DESKTOP_PROVIDER_VIEW_BASE_HEIGHT + modelCount * DESKTOP_MODEL_ROW_HEIGHT,
    ),
    DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
  );
}

export function useModelBrowser({
  providers,
  selectedProvider,
  selectedModel,
  isLoading,
  autoFocusSearch = true,
  profiles = null,
  serverId = null,
}: ModelBrowserInput): ModelBrowserState {
  const { t } = useTranslation();
  const [view, setView] = useState<ModelBrowserView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchResetKey, bumpSearchResetKey] = useReducer((key: number) => key + 1, 0);
  const hasProfiles = (profiles?.rows.length ?? 0) > 0;

  const initialView = useMemo(
    () =>
      resolveInitialModelBrowserView({ providers, selectedProvider, selectedModel, hasProfiles }),
    [hasProfiles, providers, selectedModel, selectedProvider],
  );
  const prepareToOpen = useCallback(() => {
    setView(initialView);
  }, [initialView]);
  const reset = useCallback(() => {
    setSearchQuery("");
    setIsSearchFocused(false);
    bumpSearchResetKey();
  }, []);
  const showAll = useCallback(() => {
    setView({ kind: "all" });
    reset();
  }, [reset]);
  const drillDown = useCallback(
    (providerId: string, providerLabel: string) => {
      setView({ kind: "provider", providerId, providerLabel });
      reset();
    },
    [reset],
  );
  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const singleProviderView = providers.length === 1;
  const header = useMemo<SheetHeader>(() => {
    if (view.kind === "all") {
      return {
        title: t("modelSelector.title"),
        search: {
          onChange: handleSearchQueryChange,
          onFocus: () => setIsSearchFocused(true),
          onBlur: () => setIsSearchFocused(false),
          resetKey: `all:${searchResetKey}`,
          placeholder: t("modelSelector.searchAllPlaceholder"),
          autoFocus: autoFocusSearch,
          testID: "model-search-all-input",
        },
      };
    }
    return {
      title: view.providerLabel,
      leading: (
        <ModelProviderGlyph
          provider={view.providerId}
          serverId={serverId}
          size={ICON_SIZE.md}
          tone="foreground"
        />
      ),
      back: singleProviderView ? undefined : { onPress: showAll },
      actions: (
        <div className="flex items-center gap-1">
          <ProviderSettingsAction
            serverId={serverId}
            provider={view.providerId}
            accessibilityLabel={t("modelSelector.openProviderSettings", {
              provider: view.providerLabel,
            })}
          />
        </div>
      ),
      search: {
        onChange: handleSearchQueryChange,
        onFocus: () => setIsSearchFocused(true),
        onBlur: () => setIsSearchFocused(false),
        resetKey: `${view.providerId}:${searchResetKey}`,
        placeholder: t("modelSelector.searchPlaceholder"),
        autoFocus: autoFocusSearch,
        testID: "model-search-input",
      },
    };
  }, [
    autoFocusSearch,
    handleSearchQueryChange,
    searchResetKey,
    serverId,
    singleProviderView,
    showAll,
    t,
    view,
  ]);

  const selectedModelLabel = useMemo(
    () => resolveSelectedModelLabel({ providers, selectedProvider, selectedModel, isLoading }),
    [isLoading, providers, selectedModel, selectedProvider],
  );
  const triggerLabel = useMemo(() => {
    const isPlaceholder =
      selectedModelLabel === t("modelSelector.loading") ||
      selectedModelLabel === t("modelSelector.selectModel");
    return isPlaceholder ? selectedModelLabel : buildSelectedTriggerLabel(selectedModelLabel);
  }, [selectedModelLabel, t]);
  const desktopFixedHeight = useMemo(
    () => resolveDesktopFixedHeight(view, providers),
    [providers, view],
  );

  return {
    serverId,
    providers,
    selectedProvider,
    selectedModel,
    profiles,
    view,
    searchQuery,
    isSearchFocused,
    header,
    selectedModelLabel,
    triggerLabel,
    desktopFixedHeight,
    isProviderView: view.kind === "provider",
    prepareToOpen,
    showAll,
    reset,
    drillDown,
  };
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function stopAnd(onPress: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    onPress();
  };
}

function RowLabel({
  label,
  description,
  muted = false,
}: {
  label: string;
  description?: string;
  muted?: boolean;
}) {
  return (
    <span className={cn("min-w-0 flex-1", description && "flex items-baseline gap-2")}>
      <span
        className={cn(
          "block shrink-0 truncate text-sm",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {label}
      </span>
      {description ? (
        <span className="block min-w-0 shrink truncate text-xs text-muted-foreground">
          {description}
        </span>
      ) : null}
    </span>
  );
}

function ModelBrowserRow({
  label,
  description,
  leadingSlot,
  trailingSlot,
  selected = false,
  selectionIndicator = false,
  labelMuted = false,
  onPress,
  testID,
}: {
  label: string;
  description?: string;
  leadingSlot: ReactNode;
  trailingSlot?: ReactNode;
  selected?: boolean;
  selectionIndicator?: boolean;
  /** For rows that offer an action rather than name a thing you can pick. */
  labelMuted?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const hasTrailing = selected || trailingSlot;
  return (
    <Item asChild size="xs" className="text-left">
      <button
        type="button"
        onClick={stopAnd(onPress)}
        aria-selected={selectionIndicator ? selected : undefined}
        data-testid={testID}
        className="hover:bg-muted"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">{leadingSlot}</span>
        <RowLabel label={label} description={description} muted={labelMuted} />
        {hasTrailing ? (
          <span className="ml-auto flex items-center gap-1">
            {selectionIndicator ? (
              <span className="flex w-4 items-center justify-center">
                {selected ? <Check size={ICON_SIZE.sm} className="text-muted-foreground" /> : null}
              </span>
            ) : null}
            {trailingSlot}
          </span>
        ) : null}
      </button>
    </Item>
  );
}

function ModelRowProfileAction({
  hovered,
  onPress,
  label,
  testID,
  children,
}: {
  hovered: boolean;
  onPress: () => void;
  label: string;
  testID: string;
  children: ReactNode;
}) {
  const isCompact = useIsCompactFormFactor();
  const visible = hovered || isCompact;
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={visible ? 0 : -1}
          onClick={stopAnd(onPress)}
          onKeyDown={handleKeyDown}
          aria-label={label}
          data-testid={testID}
          className={cn(ICON_BUTTON, !visible && "pointer-events-none opacity-0")}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ModelRow({
  row,
  serverId,
  isSelected,
  showProviderLabel = false,
  onPress,
  profiledRows,
  onCreateProfile,
  onEditProfile,
  onEditProfiles,
}: {
  row: ProviderSelectionModelRow;
  serverId: string | null;
  isSelected: boolean;
  showProviderLabel?: boolean;
  onPress: () => void;
  profiledRows: AgentProfilePickerRowModel[];
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
}) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const description = showProviderLabel ? buildProviderQualifiedDescription(row) : row.description;
  const primary = profiledRows[profiledRows.length - 1];
  const handleCreateProfile = useCallback(() => {
    onCreateProfile?.({ provider: row.provider, modelId: row.modelId, name: row.modelLabel });
  }, [onCreateProfile, row.modelId, row.modelLabel, row.provider]);
  const handleEditProfile = useCallback(() => {
    onEditProfile?.(primary.id);
  }, [onEditProfile, primary]);
  const handleEditProfiles = useCallback(() => {
    onEditProfiles?.();
  }, [onEditProfiles]);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  let profileAction: ReactNode = null;
  if (row.modelId.length > 0) {
    if (profiledRows.length === 0) {
      if (onCreateProfile) {
        profileAction = (
          <ModelRowProfileAction
            hovered={isHovered}
            onPress={handleCreateProfile}
            label={t("modelSelector.createProfileFromModel")}
            testID={`model-create-profile-${row.provider}-${row.modelId}`}
          >
            <Plus size={ICON_SIZE.xs} className="text-muted-foreground" />
          </ModelRowProfileAction>
        );
      }
    } else if (profiledRows.length === 1) {
      if (onEditProfile) {
        profileAction = (
          <ModelRowProfileAction
            hovered={isHovered}
            onPress={handleEditProfile}
            label={t("modelSelector.editProfileLabel", { name: primary.name })}
            testID={`model-edit-profile-${row.provider}-${row.modelId}`}
          >
            <AgentProfileGlyph icon={primary.icon} color={primary.color} size={ICON_SIZE.xs} />
          </ModelRowProfileAction>
        );
      }
    } else if (onEditProfiles) {
      profileAction = (
        <ModelRowProfileAction
          hovered={isHovered}
          onPress={handleEditProfiles}
          label={t("modelSelector.editProfilesCount", { count: profiledRows.length })}
          testID={`model-edit-profiles-${row.provider}-${row.modelId}`}
        >
          <AgentProfileGlyph icon={primary.icon} color={primary.color} size={ICON_SIZE.xs} />
        </ModelRowProfileAction>
      );
    }
  }

  return (
    <div
      className="relative"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Item asChild size="xs" className="text-left">
        <button
          type="button"
          onClick={stopAnd(onPress)}
          aria-selected={isSelected}
          data-testid={`model-row-${row.provider}-${row.modelId}`}
          className="hover:bg-muted"
        >
          <span className="flex w-4 shrink-0 items-center justify-center">
            <ModelProviderGlyph provider={row.provider} serverId={serverId} size={ICON_SIZE.sm} />
          </span>
          <RowLabel label={row.modelLabel} description={description} />
          <span className="ml-auto flex items-center gap-1">
            <span className="flex w-4 items-center justify-center">
              {isSelected ? <Check size={ICON_SIZE.sm} className="text-muted-foreground" /> : null}
            </span>
            {profileAction}
          </span>
        </button>
      </Item>
    </div>
  );
}

function SelectableModelRow({
  row,
  onSelect,
  ...props
}: {
  row: ProviderSelectionModelRow;
  serverId: string | null;
  isSelected: boolean;
  showProviderLabel?: boolean;
  onSelect: (provider: string, modelId: string) => void;
  profiledRows: AgentProfilePickerRowModel[];
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
}) {
  const handlePress = useCallback(
    () => onSelect(row.provider, row.modelId),
    [onSelect, row.modelId, row.provider],
  );
  return <ModelRow row={row} onPress={handlePress} {...props} />;
}

function AgentProfilePickerRowView({
  row,
  onApply,
}: {
  row: AgentProfilePickerRowModel;
  onApply: (profileId: string) => void;
}) {
  const handlePress = useCallback(() => onApply(row.id), [onApply, row.id]);
  const glyph = useMemo(
    () => <AgentProfileGlyph icon={row.icon} color={row.color} size={ICON_SIZE.sm} />,
    [row.color, row.icon],
  );
  return (
    <ModelBrowserRow
      label={row.name}
      description={row.summary}
      onPress={handlePress}
      leadingSlot={glyph}
      testID={`model-profile-row-${row.id}`}
    />
  );
}

const CREATE_PROFILE_ICON = (
  <span data-testid="model-profiles-create-icon" className="flex">
    <Plus size={ICON_SIZE.sm} className="text-muted-foreground" />
  </span>
);
const ALERT_ICON = <AlertTriangle size={ICON_SIZE.md} />;
const SEARCH_ICON = <Search size={ICON_SIZE.md} />;
const LOADING_ICON = <Spinner className="size-3" />;
const EMPTY_PROFILE_ROWS: AgentProfilePickerRowModel[] = [];

function SectionHeading({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className={cn("relative flex items-center gap-2 pt-2 pb-1", ROW_INSET)}>
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      {action ? <div className="absolute top-1 right-3">{action}</div> : null}
    </div>
  );
}

/**
 * Pinned above the provider list. Rows are actions, not selections: applying a
 * profile writes its values into the composer and nothing stays bound to it, so
 * there is no checkmark and no active row to show.
 */
function AgentProfilesPickerContent({
  rows,
  onApplyProfile,
  onEditProfiles,
}: {
  rows: AgentProfilePickerRowModel[];
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
}) {
  const { t } = useTranslation();
  const handleApply = useCallback(
    (profileId: string) => onApplyProfile?.(profileId),
    [onApplyProfile],
  );
  const editAction = useMemo(
    () => (onEditProfiles ? <AgentProfilesEditAction onPress={onEditProfiles} /> : undefined),
    [onEditProfiles],
  );
  if (rows.length === 0) {
    if (!onEditProfiles) return null;
    return (
      <ModelBrowserRow
        label={t("modelSelector.createProfile")}
        labelMuted
        leadingSlot={CREATE_PROFILE_ICON}
        onPress={onEditProfiles}
        testID="model-profiles-empty"
      />
    );
  }
  return (
    <div className="border-b bg-muted/50">
      <SectionHeading label={t("modelSelector.profiles")} action={editAction} />
      {rows.map((row) => (
        <AgentProfilePickerRowView key={row.id} row={row} onApply={handleApply} />
      ))}
    </div>
  );
}

function ProviderState({ provider }: { provider: ProviderSelectorProvider }) {
  const { t } = useTranslation();
  const selection = provider.modelSelection;
  if (selection.kind === "models") {
    const count = selection.rows.length;
    return (
      <span className="text-xs text-muted-foreground">
        {t(count === 1 ? "modelSelector.modelCount" : "modelSelector.modelCountPlural", { count })}
      </span>
    );
  }
  if (selection.kind === "loading") {
    return (
      <span className="flex min-w-0 shrink items-center gap-1 text-muted-foreground">
        <Spinner className="size-3" />
        <span className="text-xs">{t("modelSelector.loadingShort")}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 shrink items-center gap-1 text-muted-foreground">
      <AlertTriangle size={ICON_SIZE.sm} />
      <span className="text-xs">{t("modelSelector.error")}</span>
    </span>
  );
}

function GroupProviderButton({
  provider,
  serverId,
  onDrillDown,
}: {
  provider: ProviderSelectorProvider;
  serverId: string | null;
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  const handlePress = useCallback(
    () => onDrillDown(provider.id, provider.label),
    [onDrillDown, provider.id, provider.label],
  );
  const glyph = useMemo(
    () => <ModelProviderGlyph provider={provider.id} serverId={serverId} size={ICON_SIZE.sm} />,
    [provider.id, serverId],
  );
  const state = useMemo(
    () => (
      <span className="flex items-center gap-1">
        <ProviderState provider={provider} />
        <ChevronRight size={ICON_SIZE.sm} className="text-muted-foreground" />
      </span>
    ),
    [provider],
  );
  return (
    <ModelBrowserRow
      label={provider.label}
      leadingSlot={glyph}
      trailingSlot={state}
      onPress={handlePress}
      testID={`model-provider-${provider.id}`}
    />
  );
}

function GroupedProviderRows({
  providers,
  serverId,
  onDrillDown,
}: {
  providers: ProviderSelectorProvider[];
  serverId: string | null;
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  return (
    <div>
      {providers.map((provider, index) => (
        <div key={provider.id}>
          {index > 0 ? <Separator /> : null}
          <GroupProviderButton provider={provider} serverId={serverId} onDrillDown={onDrillDown} />
        </div>
      ))}
    </div>
  );
}

function ModelRowList({
  rows,
  serverId,
  selectedProvider,
  selectedModel,
  onSelect,
  showProviderLabel = false,
  header,
  scrolling,
  profiledLookup,
  onCreateProfile,
  onEditProfile,
  onEditProfiles,
}: {
  rows: ProviderSelectionModelRow[];
  serverId: string | null;
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: string, modelId: string) => void;
  showProviderLabel?: boolean;
  header?: ReactElement;
  scrolling: "sheet" | "independent";
  profiledLookup: Map<string, AgentProfilePickerRowModel[]>;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
}) {
  const renderRow = useCallback(
    (row: ProviderSelectionModelRow) => (
      <SelectableModelRow
        key={row.favoriteKey}
        row={row}
        serverId={serverId}
        isSelected={row.provider === selectedProvider && row.modelId === selectedModel}
        showProviderLabel={showProviderLabel}
        onSelect={onSelect}
        profiledRows={profiledLookup.get(`${row.provider}:${row.modelId}`) ?? EMPTY_PROFILE_ROWS}
        onCreateProfile={onCreateProfile}
        onEditProfile={onEditProfile}
        onEditProfiles={onEditProfiles}
      />
    ),
    [
      onCreateProfile,
      onEditProfile,
      onEditProfiles,
      onSelect,
      profiledLookup,
      selectedModel,
      selectedProvider,
      serverId,
      showProviderLabel,
    ],
  );
  if (scrolling === "independent") {
    return <IndependentModelList rows={rows} renderRow={renderRow} header={header} />;
  }
  return (
    <div>
      {header}
      {rows.map(renderRow)}
    </div>
  );
}

// A model row's height before it is measured: one 36px line; rows with profiles measure taller.
const ESTIMATED_MODEL_ROW_HEIGHT = 36;

/**
 * The Expo app's FlatList: a host-wide catalog runs to hundreds of models, so only the rows in
 * view (and a screen of overscan) are mounted.
 */
function IndependentModelList({
  rows,
  renderRow,
  header,
}: {
  rows: ProviderSelectionModelRow[];
  renderRow: (row: ProviderSelectionModelRow) => ReactElement;
  header?: ReactElement;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Where the list starts inside the scroller, below the header.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    setScrollMargin(listRef.current?.offsetTop ?? 0);
  }, [header, rows]);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => ESTIMATED_MODEL_ROW_HEIGHT, []);
  const getItemKey = useCallback((index: number) => rows[index]?.favoriteKey ?? index, [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    scrollMargin,
    overscan: 10,
  });
  const totalSize = virtualizer.getTotalSize();
  const listStyle = useMemo(() => ({ height: totalSize }), [totalSize]);
  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-y-auto pt-1 pb-8"
      data-testid="compact-model-list"
    >
      {header}
      <div ref={listRef} className="relative" style={listStyle}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <VirtualModelRow
              key={item.key}
              index={item.index}
              offset={item.start - scrollMargin}
              measure={virtualizer.measureElement}
            >
              {renderRow(row)}
            </VirtualModelRow>
          );
        })}
      </div>
    </div>
  );
}

function VirtualModelRow({
  index,
  offset,
  measure,
  children,
}: {
  index: number;
  offset: number;
  measure: (node: Element | null) => void;
  children: ReactNode;
}) {
  const style = useMemo(() => ({ transform: `translateY(${offset}px)` }), [offset]);
  return (
    <div data-index={index} ref={measure} className="absolute top-0 left-0 w-full" style={style}>
      {children}
    </div>
  );
}

function EmptyState({
  icon,
  children,
  testID,
}: {
  icon: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 py-4 text-muted-foreground"
      data-testid={testID}
    >
      {icon}
      {children}
    </div>
  );
}

function ProviderErrorEmptyState({
  providerId,
  message,
  onRetryProvider,
  isRetryingProvider,
}: {
  providerId: string;
  message: string;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(
    () => onRetryProvider?.(providerId),
    [onRetryProvider, providerId],
  );
  return (
    <EmptyState icon={ALERT_ICON}>
      <span className="text-sm">{message}</span>
      {onRetryProvider ? (
        <Button variant="default" size="sm" onClick={handleRetry} disabled={isRetryingProvider}>
          {isRetryingProvider ? t("modelSelector.retrying") : t("modelSelector.retry")}
        </Button>
      ) : null}
    </EmptyState>
  );
}

function ModelSearchEmptyState() {
  const { t } = useTranslation();
  return (
    <EmptyState icon={SEARCH_ICON}>
      <span className="text-sm">{t("modelSelector.noMatches")}</span>
    </EmptyState>
  );
}

function ProviderModelBrowserContent({
  serverId,
  view,
  provider,
  profiles,
  selectedProvider,
  selectedModel,
  normalizedQuery,
  onSelect,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  profiledLookup,
  showProfilesSection = true,
  onRetryProvider,
  isRetryingProvider,
  scrolling,
}: {
  serverId: string | null;
  view: Extract<ModelBrowserView, { kind: "provider" }>;
  provider: ProviderSelectorProvider | null;
  profiles: AgentProfilePicker | null;
  selectedProvider: string;
  selectedModel: string;
  normalizedQuery: string;
  onSelect: (provider: string, modelId: string) => void;
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  profiledLookup: Map<string, AgentProfilePickerRowModel[]>;
  showProfilesSection?: boolean;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
  scrolling: "sheet" | "independent";
}) {
  const { t } = useTranslation();
  const visibleRows = useMemo(
    () => (provider ? filterAndRankModelRows(getProviderModelRows(provider), normalizedQuery) : []),
    [normalizedQuery, provider],
  );
  const providerProfileRows = useMemo(
    () => profiles?.rows.filter((row) => row.provider === view.providerId) ?? [],
    [profiles, view.providerId],
  );
  const showProfileHeader =
    normalizedQuery.length === 0 && showProfilesSection && profiles !== null;
  const profileHeader = useMemo(
    () =>
      showProfileHeader ? (
        <AgentProfilesPickerContent
          rows={providerProfileRows}
          onApplyProfile={onApplyProfile}
          onEditProfiles={onEditProfiles}
        />
      ) : undefined,
    [onApplyProfile, onEditProfiles, providerProfileRows, showProfileHeader],
  );

  if (!provider) return <ModelSearchEmptyState />;
  const selection = provider.modelSelection;
  if (selection.kind === "loading") {
    return (
      <EmptyState icon={LOADING_ICON}>
        <span className="text-sm">{t("modelSelector.loadingShort")}</span>
      </EmptyState>
    );
  }
  if (selection.kind === "error") {
    return (
      <ProviderErrorEmptyState
        providerId={view.providerId}
        message={selection.message}
        onRetryProvider={onRetryProvider}
        isRetryingProvider={isRetryingProvider}
      />
    );
  }
  if (visibleRows.length === 0) return profileHeader ?? <ModelSearchEmptyState />;
  return (
    <ModelRowList
      serverId={serverId}
      rows={visibleRows}
      selectedProvider={selectedProvider}
      selectedModel={selectedModel}
      onSelect={onSelect}
      header={profileHeader}
      scrolling={scrolling}
      profiledLookup={profiledLookup}
      onCreateProfile={onCreateProfile}
      onEditProfile={onEditProfile}
      onEditProfiles={onEditProfiles}
    />
  );
}

function ModelBrowserContent({
  serverId,
  view,
  providers,
  selectedProvider,
  selectedModel,
  searchQuery,
  isSearchFocused,
  profiles,
  onSelect,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  onDrillDown,
  onRetryProvider,
  isRetryingProvider = false,
  scrolling,
  searchAllOnFocus,
  rootBrowseContent,
  showProfilesSection = true,
}: ModelBrowserContentProps) {
  const { t } = useTranslation();
  const normalizedQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const profiledLookup = useMemo(
    () => groupProfilesByProviderModel(profiles?.rows ?? []),
    [profiles],
  );
  const selectedViewProvider = useMemo(
    () =>
      view.kind === "provider"
        ? (providers.find((provider) => provider.id === view.providerId) ?? null)
        : null,
    [providers, view],
  );
  const allView = useMemo(
    () =>
      resolveModelBrowserAllView({
        providers,
        normalizedQuery,
        isSearchFocused: searchAllOnFocus && isSearchFocused,
      }),
    [isSearchFocused, normalizedQuery, providers, searchAllOnFocus],
  );
  const hasResults = profiles !== null || providers.length > 0 || rootBrowseContent != null;

  if (view.kind === "provider") {
    return (
      <ProviderModelBrowserContent
        serverId={serverId}
        view={view}
        provider={selectedViewProvider}
        profiles={profiles}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        normalizedQuery={normalizedQuery}
        onSelect={onSelect}
        onApplyProfile={onApplyProfile}
        onEditProfiles={onEditProfiles}
        onCreateProfile={onCreateProfile}
        onEditProfile={onEditProfile}
        profiledLookup={profiledLookup}
        showProfilesSection={showProfilesSection}
        onRetryProvider={onRetryProvider}
        isRetryingProvider={isRetryingProvider}
        scrolling={scrolling}
      />
    );
  }
  if (allView.kind === "noSearchMatches") {
    return (
      <EmptyState icon={SEARCH_ICON} testID="model-search-empty">
        <span className="text-sm">
          {t("modelSelector.noMatchesForQuery", { query: searchQuery.trim() })}
        </span>
      </EmptyState>
    );
  }
  if (allView.kind === "searchResults") {
    return (
      <ModelRowList
        serverId={serverId}
        rows={allView.rows}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onSelect={onSelect}
        showProviderLabel
        scrolling={scrolling}
        profiledLookup={profiledLookup}
        onCreateProfile={onCreateProfile}
        onEditProfile={onEditProfile}
        onEditProfiles={onEditProfiles}
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-8" data-testid="compact-provider-list">
      {showProfilesSection && profiles ? (
        <AgentProfilesPickerContent
          rows={profiles.rows}
          onApplyProfile={onApplyProfile}
          onEditProfiles={onEditProfiles}
        />
      ) : null}
      {rootBrowseContent ??
        (providers.length > 0 ? (
          <div>
            {showProfilesSection && profiles ? (
              <SectionHeading label={t("modelSelector.providers")} />
            ) : null}
            <GroupedProviderRows
              providers={providers}
              serverId={serverId}
              onDrillDown={onDrillDown}
            />
          </div>
        ) : null)}
      {!hasResults ? <ModelSearchEmptyState /> : null}
    </div>
  );
}

export function ModelBrowser({
  state,
  onSelect,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  onRetryProvider,
  isRetryingProvider = false,
  scrolling = "sheet",
  searchAllOnFocus = false,
  rootBrowseContent,
  showProfilesSection,
}: ModelBrowserProps) {
  return (
    <ModelBrowserContent
      serverId={state.serverId}
      view={state.view}
      providers={state.providers}
      selectedProvider={state.selectedProvider}
      selectedModel={state.selectedModel}
      searchQuery={state.searchQuery}
      isSearchFocused={state.isSearchFocused}
      profiles={state.profiles}
      onSelect={onSelect}
      onApplyProfile={onApplyProfile}
      onEditProfiles={onEditProfiles}
      onCreateProfile={onCreateProfile}
      onEditProfile={onEditProfile}
      onDrillDown={state.drillDown}
      onRetryProvider={onRetryProvider}
      isRetryingProvider={isRetryingProvider}
      scrolling={scrolling}
      searchAllOnFocus={searchAllOnFocus}
      rootBrowseContent={rootBrowseContent}
      showProfilesSection={showProfilesSection}
    />
  );
}
