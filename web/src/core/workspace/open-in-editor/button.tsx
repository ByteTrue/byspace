// Port of archive/expo-app:packages/app/src/workspace/open-in-editor/button.tsx: the header's "Open" split
// button (open the workspace or file on its forge), with a menu to pick and remember the target.
import { ButtonGroup } from "~/components/ui/button-group";
import { Button } from "~/components/ui/button";
import { useCallback, useMemo, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { ForgeIcon } from "~/components/forge-icon";
import { Spinner } from "~/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";

interface WorkspaceOpenInEditorButtonProps {
  serverId: string;
  cwd: string;
  activeFile?: WorkspaceFileLocation | null;
  hideLabels?: boolean;
  /** shadcn's Button size for the header; default is the standalone size. */
  size?: "default" | "sm";
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
      data-testid={`workspace-open-in-editor-item-${target.id}`}
      onSelect={handleSelect}
    >
      {target.icon}
      {target.label}
      <DropdownMenuShortcut>{isPreferred ? CHECK_ICON : undefined}</DropdownMenuShortcut>
    </DropdownMenuItem>
  );
}

export function WorkspaceOpenInEditorButton({
  serverId,
  cwd,
  activeFile,
  hideLabels,
  size = "default",
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

  let openButtonSize: "icon" | "default" | "icon-sm" | "sm" = hideLabels ? "icon" : "default";
  if (size === "sm") openButtonSize = hideLabels ? "icon-sm" : "sm";
  const caretSize = size === "sm" ? "icon-sm" : "icon";

  if (!canResolveWorkspace || !primaryOption || targets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ButtonGroup>
        <Button
          variant="outline"
          size={openButtonSize}
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
        >
          {openMutation.isPending ? <Spinner /> : primaryOption.icon}
          {hideLabels ? null : t("workspace.git.openInEditor.open")}
        </Button>
        {targets.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size={caretSize}
                data-testid="workspace-open-in-editor-caret"
                aria-label={t("workspace.git.openInEditor.chooseEditor")}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              data-testid="workspace-open-in-editor-menu"
              className="w-max min-w-[148px] max-w-[176px]"
              onCloseAutoFocus={keepFocusElsewhere}
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
      </ButtonGroup>
    </div>
  );
}
