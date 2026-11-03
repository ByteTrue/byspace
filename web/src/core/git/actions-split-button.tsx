// Port of archive/expo-app:packages/app/src/git/actions-split-button.tsx: the header's git split button
// (primary action, a caret menu of secondary actions, and a "more" menu), or a single menu
// trigger when space is short. Same actions and test IDs; shadcn view.
import { useCallback, useMemo } from "react";
import { Check, ChevronDown, GitBranch, MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Shortcut } from "~/components/shortcut";
import type { GitAction, GitActions } from "@/git/policy";
import { useGitActionRunner } from "@/git/use-actions";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepOpen } from "~/components/menu-kit";
import { keepFocusElsewhere } from "~/lib/menu-focus";

interface GitActionsSplitButtonProps {
  gitActions: GitActions;
  hideLabels?: boolean;
  menuOnly?: boolean;
}

function closesOnSelect(action: GitAction): boolean {
  return (
    action.status === "idle" &&
    action.id === "pr" &&
    action.label === action.pendingLabel &&
    action.label === action.successLabel
  );
}

function GitActionMenuItem({
  action,
  onSelect,
  archiveShortcutKeys,
  needsSeparator,
  showSeparator,
  closeOnSelect,
}: {
  action: GitAction;
  onSelect: (action: GitAction) => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  needsSeparator?: boolean;
  showSeparator?: boolean;
  closeOnSelect?: boolean;
}) {
  const handleSelect = useCallback(() => onSelect(action), [onSelect, action]);
  const trailing = useMemo(
    () =>
      action.id === "archive-workspace" && archiveShortcutKeys ? (
        <Shortcut chord={archiveShortcutKeys} />
      ) : undefined,
    [action.id, archiveShortcutKeys],
  );
  // While it runs the row shows a spinner and its pending label; once done, a check and its
  // success label.
  let icon = action.icon;
  let label = action.label;
  if (action.status === "pending") {
    icon = <Spinner />;
    label = action.pendingLabel;
  } else if (action.status === "success") {
    icon = <Check className="text-status-success" />;
    label = action.successLabel;
  }
  return (
    <>
      {needsSeparator && showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        data-testid={
          action.id === "archive-workspace"
            ? "workspace-archive-action"
            : `changes-menu-${action.id}`
        }
        disabled={action.disabled || action.status !== "idle"}
        onSelect={closeOnSelect === false ? keepOpen(handleSelect) : handleSelect}
        className={cn(
          action.unavailableMessage && "text-muted-foreground",
          action.status === "success" && "text-status-success",
        )}
      >
        {icon}
        {label}
        {trailing ? <DropdownMenuShortcut>{trailing}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    </>
  );
}

// The Expo app's split button parts: 28px at every width (buttonControlHeight.xs below md,
// HEADER_CONTROL_HEIGHT from md up).
const CONTROL_HEIGHT = "h-7";

export function GitActionsSplitButton({
  gitActions,
  hideLabels,
  menuOnly = false,
}: GitActionsSplitButtonProps) {
  const { t } = useTranslation();
  const runGitAction = useGitActionRunner();
  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const primary = gitActions.primary;
  const handlePrimaryPress = useCallback(() => {
    if (primary) runGitAction(primary);
  }, [primary, runGitAction]);
  const menuOnlyActions = useMemo(
    () => [...(primary ? [primary] : []), ...gitActions.secondary, ...gitActions.menu],
    [gitActions.menu, gitActions.secondary, primary],
  );

  if (menuOnly) {
    if (menuOnlyActions.length === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="changes-actions-menu-trigger"
          aria-label={t("workspace.header.actions.workspaceActions")}
          className={cn(
            "flex w-12 items-center justify-center gap-1 rounded-md border bg-background text-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-[42px] dark:bg-input/30",
            CONTROL_HEIGHT,
          )}
        >
          <GitBranch size={16} />
          <ChevronDown size={12} className="opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-testid="changes-primary-cta-menu"
          className="w-max"
          onCloseAutoFocus={keepFocusElsewhere}
        >
          {menuOnlyActions.map((action, index) => (
            <GitActionMenuItem
              key={action.id}
              action={action}
              onSelect={runGitAction}
              archiveShortcutKeys={archiveShortcutKeys}
              needsSeparator={action.startsGroup}
              showSeparator={index > 0}
              closeOnSelect={closesOnSelect(action)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (!primary && gitActions.secondary.length === 0 && gitActions.menu.length === 0) return null;

  let primaryLabel = primary?.label ?? "";
  if (primary?.status === "pending") primaryLabel = primary.pendingLabel;
  else if (primary?.status === "success") primaryLabel = primary.successLabel;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {primary ? (
        <div
          className={cn(
            "flex items-stretch overflow-hidden rounded-md border bg-background dark:border-input dark:bg-input/30",
            CONTROL_HEIGHT,
          )}
        >
          <button
            type="button"
            data-testid="changes-primary-cta"
            onClick={handlePrimaryPress}
            disabled={primary.disabled}
            aria-label={primary.label}
            className="relative flex items-center justify-center px-3 hover:bg-muted disabled:opacity-60 md:px-2 dark:hover:bg-input/50"
          >
            {primary.status === "pending" ? (
              <Spinner className="size-3.5" />
            ) : (
              <span className="flex items-center gap-2 md:gap-1 [&_svg]:size-4">
                {primary.icon}
                {hideLabels ? null : (
                  <span className="text-sm leading-[21px] font-medium text-foreground">
                    {primaryLabel}
                  </span>
                )}
              </span>
            )}
          </button>
          {gitActions.secondary.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="changes-primary-cta-caret"
                aria-label={t("workspace.git.actions.moreOptions")}
                className="flex w-8 items-center justify-center border-l text-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-7 dark:border-input dark:hover:bg-input/50"
              >
                <ChevronDown size={16} className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                data-testid="changes-primary-cta-menu"
                className="w-max"
                onCloseAutoFocus={keepFocusElsewhere}
              >
                {gitActions.secondary.map((action, index) => (
                  <GitActionMenuItem
                    key={action.id}
                    action={action}
                    onSelect={runGitAction}
                    archiveShortcutKeys={archiveShortcutKeys}
                    needsSeparator={action.startsGroup}
                    showSeparator={index > 0}
                    closeOnSelect={closesOnSelect(action)}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
      {gitActions.menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="changes-overflow-menu"
            aria-label={t("workspace.git.actions.moreActions")}
            className={cn(
              "-mr-2 flex w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-7",
              CONTROL_HEIGHT,
            )}
          >
            <MoreVertical size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            data-testid="changes-overflow-content"
            className="w-[220px]"
            onCloseAutoFocus={keepFocusElsewhere}
          >
            {gitActions.menu.map((action) => (
              <GitActionMenuItem
                key={action.id}
                action={action}
                onSelect={runGitAction}
                closeOnSelect={false}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
