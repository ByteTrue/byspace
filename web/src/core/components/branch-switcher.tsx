// Port of archive/expo-app:packages/app/src/components/branch-switcher.tsx: the branch label in a toolbar that
// opens a searchable branch list. Switching is the shared useBranchSwitcher; the view is DOM.
import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher, type BranchSuggestionScope } from "@/hooks/use-branch-switcher";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

interface BranchSwitcherProps {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  testID?: string;
}

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
      <span aria-hidden className="flex text-muted-foreground">
        <Download size={14} />
      </span>
    );
  }
  if (scope === "local-and-remote") {
    return (
      <span aria-hidden className="flex items-center gap-1 text-muted-foreground">
        <GitBranch size={12} />
        <Download size={12} />
      </span>
    );
  }
  return (
    <span aria-hidden className="flex text-muted-foreground">
      <GitBranch size={14} />
    </span>
  );
}

const BRANCH_LEADING_ICON = <GitBranch size={13} className="text-muted-foreground" />;
const BRANCH_OPTION_ICONS: Record<BranchSuggestionScope, ReactElement> = {
  local: <BranchOptionIcon scope="local" />,
  remote: <BranchOptionIcon scope="remote" />,
  "local-and-remote": <BranchOptionIcon scope="local-and-remote" />,
};

export function BranchSwitcher({
  currentBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  isGitCheckout,
  testID = "workspace-header-branch-switcher",
}: BranchSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
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
        leadingSlot={BRANCH_OPTION_ICONS[resolveBranchOptionScope(option) ?? "local"]}
      />
    ),
    [],
  );
  const triggerLabel = useMemo(
    () =>
      currentBranchName
        ? t("branchSwitcher.currentBranch", { branchName: currentBranchName })
        : undefined,
    [currentBranchName, t],
  );

  if (!currentBranchName) {
    return null;
  }

  return (
    <div ref={anchorRef} className="flex min-w-0 shrink">
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <ToolbarLabelSelectTrigger
            testID={testID}
            label={currentBranchName}
            leadingIcon={BRANCH_LEADING_ICON}
            open={isOpen}
            onPress={handleOpen}
            accessibilityLabel={triggerLabel}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("branchSwitcher.triggerTooltip")}</TooltipContent>
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
    </div>
  );
}
