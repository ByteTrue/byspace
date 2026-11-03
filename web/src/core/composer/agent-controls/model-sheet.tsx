// Port of archive/expo-app:packages/app/src/composer/agent-controls/model-sheet.tsx: the narrow composer's one
// model button ("model · thinking"). It opens a sheet with the model browser over the remaining
// controls; on a phone the controls are a list and the model row drills into a second sheet.
import { Separator } from "~/components/ui/separator";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import type { AgentProfilePicker, AgentProfileSeed } from "@/agent-profiles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { getProviderIcon } from "@/components/provider-icons";
import { ModelBrowser, useModelBrowser } from "@/components/model-browser";
import { resolveModelBrowserScrolling } from "@/components/model-browser-view";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { resolveModelSheetOpening } from "@/composer/agent-controls/model-sheet-flow";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useIsCompactFormFactor } from "@/constants/layout";
import { cn } from "cn";

const MODEL_LIST_TOP_INSET = 4;
const MODEL_ROW_STRIDE = 44;
const MODEL_VIEWPORT_VISIBLE_ROWS = 4.5;
const FIXED_MODEL_VIEWPORT_HEIGHT =
  MODEL_LIST_TOP_INSET + MODEL_ROW_STRIDE * MODEL_VIEWPORT_VISIBLE_ROWS;
const FIXED_VIEWPORT_STYLE = { height: FIXED_MODEL_VIEWPORT_HEIGHT };

interface CompactModelSheetProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  thinkingLabel: string | null;
  onSelect: (provider: string, modelId: string) => void;
  isLoading: boolean;
  profiles?: AgentProfilePicker | null;
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  disabled?: boolean;
  serverId?: string | null;
  glyphSize: number;
  canSwitchProvider: boolean;
  children: ReactNode;
}

function shortModelLabel(label: string): string {
  const separatorIndex = label.lastIndexOf("/");
  return separatorIndex === -1 ? label : label.slice(separatorIndex + 1);
}

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function CompactModelSheet({
  providers,
  selectedProvider,
  selectedModel,
  thinkingLabel,
  onSelect,
  isLoading,
  profiles = null,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  onOpen,
  onClose,
  onRetryProvider,
  isRetryingProvider = false,
  disabled = false,
  serverId = null,
  glyphSize,
  canSwitchProvider,
  children,
}: CompactModelSheetProps) {
  const { t } = useTranslation();
  const usesBottomSheet = useIsCompactFormFactor();
  const modelBrowserScrolling = resolveModelBrowserScrolling({ isCompact: usesBottomSheet });
  const [isOpen, setIsOpen] = useState(false);
  const [isModelBrowserOpen, setIsModelBrowserOpen] = useState(false);
  const availableProviders = useMemo(() => {
    if (canSwitchProvider) return providers;
    const fixedProvider =
      providers.find((entry) => entry.id === selectedProvider) ?? providers[0] ?? null;
    return fixedProvider ? [fixedProvider] : [];
  }, [canSwitchProvider, providers, selectedProvider]);
  const browserInput = {
    providers: availableProviders,
    selectedProvider,
    selectedModel,
    isLoading,
    autoFocusSearch: !usesBottomSheet,
    profiles,
    serverId,
  };
  const rootBrowser = useModelBrowser(browserInput);
  const modelBrowser = useModelBrowser(browserInput);
  const ProviderIcon =
    selectedProvider.trim().length > 0 ? getProviderIcon(selectedProvider, serverId) : null;
  const ModelIcon = ProviderIcon ?? Bot;
  const rootHeader = useMemo(
    () => ({
      ...rootBrowser.header,
      title: t("modelSelector.selectModel"),
      search:
        rootBrowser.header.search && !canSwitchProvider
          ? { ...rootBrowser.header.search, placeholder: t("modelSelector.searchPlaceholder") }
          : rootBrowser.header.search,
    }),
    [canSwitchProvider, rootBrowser.header, t],
  );

  const open = useCallback(() => {
    blurActiveElement();
    rootBrowser.showAll();
    setIsOpen(true);
    onOpen?.();
  }, [onOpen, rootBrowser]);
  const close = useCallback(() => {
    setIsModelBrowserOpen(false);
    setIsOpen(false);
    rootBrowser.reset();
    modelBrowser.reset();
    onClose?.();
  }, [modelBrowser, onClose, rootBrowser]);
  const handleSearchSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      blurActiveElement();
      rootBrowser.showAll();
    },
    [onSelect, rootBrowser],
  );
  const openModelBrowser = useCallback(() => {
    blurActiveElement();
    const destination = resolveModelSheetOpening({
      canSwitchProvider,
      providers: availableProviders,
      selectedProvider,
    });
    if (destination.kind === "all") modelBrowser.showAll();
    else modelBrowser.drillDown(destination.providerId, destination.providerLabel);
    setIsModelBrowserOpen(true);
  }, [availableProviders, canSwitchProvider, modelBrowser, selectedProvider]);
  const closeModelBrowser = useCallback(() => {
    setIsModelBrowserOpen(false);
    modelBrowser.reset();
  }, [modelBrowser]);
  const handleBrowserSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      closeModelBrowser();
    },
    [closeModelBrowser, onSelect],
  );
  const handleDesktopSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      close();
    },
    [close, onSelect],
  );
  const handleApplyProfile = useCallback(
    (profileId: string) => {
      onApplyProfile?.(profileId);
      close();
    },
    [close, onApplyProfile],
  );
  const handleEditProfiles = useCallback(() => {
    close();
    onEditProfiles?.();
  }, [close, onEditProfiles]);
  const handleCreateProfile = useCallback(
    (seed: AgentProfileSeed) => {
      close();
      onCreateProfile?.(seed);
    },
    [close, onCreateProfile],
  );
  const handleEditProfile = useCallback(
    (profileId: string) => {
      close();
      onEditProfile?.(profileId);
    },
    [close, onEditProfile],
  );
  const createProfile = onCreateProfile ? handleCreateProfile : undefined;
  const editProfile = onEditProfile ? handleEditProfile : undefined;
  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [close, isOpen, open]);

  const mobileRootContent = (
    <div className="border-t bg-sidebar" data-testid="agent-controls-settings-list">
      <div className="flex flex-col gap-1 px-2 py-3">
        <AgentControlTrigger
          icon={ModelIcon}
          surface="sheet"
          label={t("modelSelector.model")}
          value={rootBrowser.selectedModelLabel}
          disabled={disabled}
          onPress={openModelBrowser}
          accessibilityLabel={t("modelSelector.selectedModel", {
            model: rootBrowser.selectedModelLabel,
          })}
          testID="agent-controls-model"
        />
        {children}
      </div>
    </div>
  );

  return (
    <>
      <ComboboxTrigger
        disabled={disabled}
        onPress={toggle}
        accessibilityLabel={t("modelSelector.selectedModel", {
          model: rootBrowser.selectedModelLabel,
        })}
        aria-expanded={isOpen}
        testID="combined-model-selector"
        chevron={null}
        className="shrink"
      >
        {ProviderIcon ? (
          <ComposerToolbarGlyph size={glyphSize}>
            <span className="flex text-muted-foreground">
              <ProviderIcon size={glyphSize} color="currentColor" />
            </span>
          </ComposerToolbarGlyph>
        ) : null}
        <span className="flex min-w-0 shrink items-center gap-1 text-sm">
          <span className="min-w-0 shrink truncate text-muted-foreground">
            {shortModelLabel(rootBrowser.triggerLabel)}
          </span>
          {thinkingLabel ? (
            <span className="shrink-0 text-muted-foreground">{thinkingLabel}</span>
          ) : null}
        </span>
      </ComboboxTrigger>

      <AdaptiveModalSheet
        header={rootHeader}
        visible={isOpen}
        onClose={close}
        scrollable={false}
        contentClassName="gap-0 p-0"
        testID="agent-controls-model-sheet"
      >
        <div
          className={cn(
            "flex flex-col overflow-hidden bg-sidebar",
            usesBottomSheet ? "min-h-0 flex-1" : "shrink-0",
          )}
          style={usesBottomSheet ? undefined : FIXED_VIEWPORT_STYLE}
          data-testid="agent-controls-model-viewport"
        >
          <ModelBrowser
            state={rootBrowser}
            onSelect={usesBottomSheet ? handleSearchSelect : handleDesktopSelect}
            onApplyProfile={handleApplyProfile}
            onEditProfiles={onEditProfiles ? handleEditProfiles : undefined}
            onCreateProfile={createProfile}
            onEditProfile={editProfile}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
            scrolling={modelBrowserScrolling}
            searchAllOnFocus={usesBottomSheet}
            rootBrowseContent={usesBottomSheet ? mobileRootContent : undefined}
          />
        </div>
        {!usesBottomSheet ? (
          <>
            <Separator />
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              data-testid="agent-controls-settings-list"
            >
              <div className="flex flex-col gap-1 px-2 py-3">{children}</div>
            </div>
          </>
        ) : null}
      </AdaptiveModalSheet>

      {usesBottomSheet ? (
        <AdaptiveModalSheet
          header={modelBrowser.header}
          visible={isModelBrowserOpen}
          onClose={closeModelBrowser}
          scrollable={false}
          contentClassName="gap-0 p-0"
          testID="agent-controls-model-browser-sheet"
        >
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar"
            data-testid="agent-controls-model-browser-viewport"
          >
            <ModelBrowser
              state={modelBrowser}
              onSelect={handleBrowserSelect}
              onEditProfiles={onEditProfiles ? handleEditProfiles : undefined}
              onCreateProfile={createProfile}
              onEditProfile={editProfile}
              onRetryProvider={onRetryProvider}
              isRetryingProvider={isRetryingProvider}
              scrolling={modelBrowserScrolling}
              searchAllOnFocus
              showProfilesSection={false}
            />
          </div>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}
