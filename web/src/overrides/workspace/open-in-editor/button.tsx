// Override of packages/app/src/workspace/open-in-editor/button.tsx: the header's "Open" split
// button (open the workspace or file on its forge), with a menu to pick and remember the target.
import { useCallback, useMemo, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { getForgePresentation } from "@/git/forge";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { resolvePreferredEditorId, usePreferredEditor } from "@/hooks/use-preferred-editor";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { openExternalUrl } from "@/utils/open-external-url";
import { isAbsolutePath } from "@/utils/path";
import { resolveWorkspaceFilePaths, type WorkspaceFileLocation } from "@/workspace/file-open";
import { planWorkspaceOpenTargets } from "@/workspace/open-in-editor/planner";
import { cn } from "cn";
import { ForgeIcon } from "~/components/forge-icon";
import { Spinner } from "~/components/ui/spinner";

interface WorkspaceOpenInEditorButtonProps {
  serverId: string;
  cwd: string;
  activeFile?: WorkspaceFileLocation | null;
  hideLabels?: boolean;
}

interface OpenTarget {
  id: string;
  label: string;
  icon: ReactElement;
  onOpen: () => Promise<void> | void;
}

const CHECK_ICON = <Check size={16} />;

function OpenTargetMenuItem({
  target,
  isPreferred,
  onSelect,
}: {
  target: OpenTarget;
  isPreferred: boolean;
  onSelect: (target: OpenTarget) => void;
}) {
  const handleSelect = useCallback(() => onSelect(target), [onSelect, target]);
  return (
    <DropdownMenuItem
      testID={`workspace-open-in-editor-item-${target.id}`}
      leading={target.icon}
      trailing={isPreferred ? CHECK_ICON : undefined}
      onSelect={handleSelect}
    >
      {target.label}
    </DropdownMenuItem>
  );
}

export function WorkspaceOpenInEditorButton({
  serverId,
  cwd,
  activeFile,
  hideLabels,
}: WorkspaceOpenInEditorButtonProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { preferredEditorId, updatePreferredEditor } = usePreferredEditor();
  const resolvedFile = useMemo(
    () =>
      activeFile ? resolveWorkspaceFilePaths({ path: activeFile.path, workspaceRoot: cwd }) : null,
    [activeFile, cwd],
  );
  const activeFileName = useMemo(
    () => resolvedFile?.absolutePath.split("/").findLast(Boolean) ?? null,
    [resolvedFile],
  );
  const canResolveWorkspace = cwd.trim().length > 0 && isAbsolutePath(cwd);
  const shouldQueryCheckout = canResolveWorkspace && isConnected;
  const { status: checkoutStatus } = useCheckoutStatusQuery({
    serverId,
    cwd: shouldQueryCheckout ? cwd : "",
  });
  const { resolvedForge } = useCheckoutPrStatusQuery({
    serverId,
    cwd: shouldQueryCheckout ? cwd : "",
  });
  const targets = useMemo<OpenTarget[]>(
    () =>
      planWorkspaceOpenTargets({
        workspaceDirectory: cwd,
        activeFile,
        resolvedActiveFile: resolvedFile,
        checkoutStatus,
        forge: resolvedForge,
      }).map((target) => ({
        id: target.id,
        label: target.label,
        icon: (
          <ForgeIcon
            iconKind={getForgePresentation(target.forge).icon}
            className="size-4 text-muted-foreground"
          />
        ),
        onOpen: () => openExternalUrl(target.url),
      })),
    [activeFile, checkoutStatus, cwd, resolvedForge, resolvedFile],
  );
  const targetIds = useMemo(() => targets.map((target) => target.id), [targets]);
  const effectivePreferredEditorId = useMemo(
    () => resolvePreferredEditorId(targetIds, preferredEditorId),
    [targetIds, preferredEditorId],
  );
  const primaryOption = targets.find((target) => target.id === effectivePreferredEditorId) ?? null;
  const openMutation = useMutation({
    mutationFn: (target: OpenTarget) => Promise.resolve(target.onOpen()),
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : t("workspace.git.openInEditor.failedOpen"),
      );
    },
  });
  const handleSelectTarget = useCallback(
    (target: OpenTarget) => void updatePreferredEditor(target.id).catch(() => undefined),
    [updatePreferredEditor],
  );
  const handlePrimaryPress = useCallback(() => {
    if (primaryOption) openMutation.mutate(primaryOption);
  }, [openMutation, primaryOption]);

  if (!canResolveWorkspace || !primaryOption || targets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="flex h-8 items-stretch overflow-hidden rounded-md border bg-background shadow-xs md:h-7 dark:border-input dark:bg-input/30">
        <button
          type="button"
          data-testid="workspace-open-in-editor-primary"
          onClick={handlePrimaryPress}
          disabled={openMutation.isPending}
          aria-label={
            activeFileName
              ? t("workspace.git.openInEditor.openFileIn", {
                  fileName: activeFileName,
                  target: primaryOption.label,
                })
              : t("workspace.git.openInEditor.openIn", { target: primaryOption.label })
          }
          className={cn(
            "relative flex items-center justify-center hover:bg-muted disabled:opacity-60 dark:hover:bg-input/50",
            hideLabels ? "w-8 md:w-7" : "px-3 md:px-2",
          )}
        >
          {openMutation.isPending ? (
            <Spinner className="size-3.5" />
          ) : (
            <span className="flex items-center justify-center gap-2">
              {primaryOption.icon}
              {hideLabels ? null : (
                <span className="text-sm font-medium text-foreground">
                  {t("workspace.git.openInEditor.open")}
                </span>
              )}
            </span>
          )}
        </button>
        {targets.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              testID="workspace-open-in-editor-caret"
              accessibilityLabel={t("workspace.git.openInEditor.chooseEditor")}
              className="flex w-8 items-center justify-center border-l text-extra-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-7 dark:border-input dark:hover:bg-input/50"
            >
              <ChevronDown size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              minWidth={148}
              maxWidth={176}
              testID="workspace-open-in-editor-menu"
            >
              {targets.map((target) => (
                <OpenTargetMenuItem
                  key={target.id}
                  target={target}
                  isPreferred={target.id === effectivePreferredEditorId}
                  onSelect={handleSelectTarget}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
