import { useCallback, useRef } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Download, GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher, type BranchSuggestionScope } from "@/hooks/use-branch-switcher";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";

interface BranchSwitcherProps {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  testID?: string;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedDownload = withUnistyles(Download);

function isBranchSuggestionScope(value: unknown): value is BranchSuggestionScope {
  return value === "local" || value === "remote" || value === "local-and-remote";
}

function resolveBranchOptionScope(
  option: ComboboxProps["options"][number],
): BranchSuggestionScope | undefined {
  if (!("scope" in option) || !isBranchSuggestionScope(option.scope)) {
    return undefined;
  }
  return option.scope;
}

function BranchOptionIcon({ scope }: { scope?: BranchSuggestionScope }) {
  if (scope === "remote") {
    return (
      <View accessible={false}>
        <ThemedDownload size={14} uniProps={foregroundMutedIconColorMapping} />
      </View>
    );
  }
  if (scope === "local-and-remote") {
    return (
      <View accessible={false} style={styles.combinedIcon}>
        <ThemedGitBranch size={12} uniProps={foregroundMutedIconColorMapping} />
        <ThemedDownload size={12} uniProps={foregroundMutedIconColorMapping} />
      </View>
    );
  }
  return (
    <View accessible={false}>
      <ThemedGitBranch size={14} uniProps={foregroundMutedIconColorMapping} />
    </View>
  );
}

export function BranchSwitcher({
  currentBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  isGitCheckout,
  testID = "workspace-header-branch-switcher",
}: BranchSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { branchOptions, isOpen, setIsOpen, handleBranchSelect } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory,
    currentBranchName,
    isGitCheckout,
    isConnected,
    toast,
    queryClient,
  });

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);
  const renderBranchOptionLeadingSlot = useCallback(
    (scope?: BranchSuggestionScope) => <BranchOptionIcon scope={scope} />,
    [],
  );

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        description={option.description}
        accessibilityLabel={
          option.description ? `${option.label}, ${option.description}` : option.label
        }
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={renderBranchOptionLeadingSlot(resolveBranchOptionScope(option))}
      />
    ),
    [renderBranchOptionLeadingSlot],
  );

  if (!currentBranchName) {
    return null;
  }

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <ToolbarLabelSelectTrigger
            testID={testID}
            label={currentBranchName}
            open={isOpen}
            onPress={handleOpen}
            accessibilityRole="button"
            accessibilityLabel={t("branchSwitcher.currentBranch", {
              branchName: currentBranchName,
            })}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{t("branchSwitcher.triggerTooltip")}</Text>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={branchOptions}
        value={currentBranchName}
        onSelect={handleBranchSelect}
        searchable
        placeholder={t("branchSwitcher.placeholder")}
        searchPlaceholder={t("branchSwitcher.searchPlaceholder")}
        emptyText={t("branchSwitcher.empty")}
        title={t("branchSwitcher.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderBranchOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
  combinedIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
