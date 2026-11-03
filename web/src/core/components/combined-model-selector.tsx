// Port of archive/expo-app:packages/app/src/components/combined-model-selector.tsx: the model trigger (provider
// glyph + model label, or a caller-drawn trigger) and the model browser in a combobox.
import { Button } from "~/components/ui/button";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProvider } from "@bytetrue/protocol/agent-types";
import type { AgentProfilePicker, AgentProfileSeed } from "@/agent-profiles";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { ModelBrowser, ModelProviderGlyph, useModelBrowser } from "@/components/model-browser";
import { resolveModelBrowserScrolling } from "@/components/model-browser-view";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { ICON_SIZE } from "@/styles/theme";
import { cn } from "cn";

const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];
function noop() {}

interface CombinedModelSelectorProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: AgentProvider, modelId: string) => void;
  isLoading: boolean;
  profiles?: AgentProfilePicker | null;
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  renderTrigger?: (input: {
    selectedModelLabel: string;
    onPress: () => void;
    disabled: boolean;
    isOpen: boolean;
  }) => ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  disabled?: boolean;
  serverId?: string | null;
  desktopPlacement?: ComboboxProps["desktopPlacement"];
  desktopMinWidth?: number;
  /** A caller-drawn trigger fills its container as a form field instead of a toolbar chip. */
  triggerFill?: boolean;
  toolbar?: {
    glyphSize: number;
    showCaret: boolean;
  };
}

export function CombinedModelSelector({
  providers,
  selectedProvider,
  selectedModel,
  onSelect,
  isLoading,
  profiles = null,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  renderTrigger,
  onOpen,
  onClose,
  onRetryProvider,
  isRetryingProvider = false,
  disabled = false,
  serverId = null,
  desktopPlacement,
  desktopMinWidth,
  triggerFill = false,
  toolbar,
}: CombinedModelSelectorProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const modelBrowserScrolling = resolveModelBrowserScrolling({ isCompact });
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const browser = useModelBrowser({
    providers,
    selectedProvider,
    selectedModel,
    isLoading,
    profiles,
    serverId,
  });
  const { prepareToOpen, reset } = browser;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) {
        prepareToOpen();
        onOpen?.();
        return;
      }
      reset();
      onClose?.();
    },
    [onClose, onOpen, prepareToOpen, reset],
  );
  const handleSelect = useCallback(
    (provider: string, modelId: string) => {
      onSelect(provider, modelId);
      handleOpenChange(false);
    },
    [handleOpenChange, onSelect],
  );
  const handleTriggerPress = useCallback(
    () => handleOpenChange(!isOpen),
    [handleOpenChange, isOpen],
  );
  const handleApplyProfile = useCallback(
    (profileId: string) => {
      onApplyProfile?.(profileId);
      handleOpenChange(false);
    },
    [handleOpenChange, onApplyProfile],
  );
  const handleEditProfiles = useCallback(() => {
    handleOpenChange(false);
    onEditProfiles?.();
  }, [handleOpenChange, onEditProfiles]);
  const handleCreateProfile = useCallback(
    (seed: AgentProfileSeed) => {
      handleOpenChange(false);
      onCreateProfile?.(seed);
    },
    [handleOpenChange, onCreateProfile],
  );
  const handleEditProfile = useCallback(
    (profileId: string) => {
      handleOpenChange(false);
      onEditProfile?.(profileId);
    },
    [handleOpenChange, onEditProfile],
  );
  const accessibilityLabel = t("modelSelector.selectedModel", {
    model: browser.selectedModelLabel,
  });

  return (
    <>
      {renderTrigger ? (
        <Button
          ref={anchorRef}
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={handleTriggerPress}
          aria-label={accessibilityLabel}
          aria-expanded={isOpen}
          data-testid="combined-model-selector"
          className={cn("min-w-0 justify-start font-normal", triggerFill ? "w-full" : "shrink")}
        >
          {renderTrigger({
            selectedModelLabel: browser.triggerLabel,
            onPress: handleTriggerPress,
            disabled,
            isOpen,
          })}
        </Button>
      ) : (
        <ComboboxTrigger
          ref={anchorRef}
          disabled={disabled}
          onPress={handleTriggerPress}
          accessibilityLabel={accessibilityLabel}
          aria-expanded={isOpen}
          testID="combined-model-selector"
          chevron={toolbar?.showCaret === false ? null : undefined}
          className="shrink"
        >
          {selectedProvider.trim().length > 0 ? (
            <span className={cn("flex shrink-0", toolbar?.glyphSize === 20 ? "size-5" : "size-4")}>
              <ModelProviderGlyph
                provider={selectedProvider}
                serverId={serverId}
                size={toolbar?.glyphSize ?? ICON_SIZE.md}
              />
            </span>
          ) : null}
          <span className="min-w-0 shrink truncate text-sm text-muted-foreground">
            {browser.triggerLabel}
          </span>
        </ComboboxTrigger>
      )}
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        value=""
        onSelect={noop}
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={desktopPlacement}
        desktopMinWidth={desktopMinWidth}
        desktopLockWidth
        desktopFixedHeight={browser.desktopFixedHeight}
        desktopChildrenScrollEnabled={false}
        header={browser.header}
        mobileChildrenScrollEnabled
        mobileChildrenContentClassName="px-0"
      >
        <ModelBrowser
          state={browser}
          onSelect={handleSelect}
          onApplyProfile={handleApplyProfile}
          onEditProfiles={onEditProfiles ? handleEditProfiles : undefined}
          onCreateProfile={onCreateProfile ? handleCreateProfile : undefined}
          onEditProfile={onEditProfile ? handleEditProfile : undefined}
          onRetryProvider={onRetryProvider}
          isRetryingProvider={isRetryingProvider}
          scrolling={modelBrowserScrolling}
        />
      </Combobox>
    </>
  );
}
