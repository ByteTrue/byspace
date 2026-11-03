// Port of archive/expo-app:packages/app/src/git/actions-split-button.tsx: the header's git split button
// (primary action, a caret menu of secondary actions, and a "more" menu), or a single menu
// trigger when space is short. Same actions and test IDs; shadcn view.
import { useCallback, useMemo } from "react";
import { ChevronDown, GitBranch, MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "~/components/shortcut";
import type { GitAction, GitActions } from "@/git/policy";
import { useGitActionRunner } from "@/git/use-actions";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";

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
  return (
    <>
      {needsSeparator && showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        testID={
          action.id === "archive-workspace"
            ? "workspace-archive-action"
            : `changes-menu-${action.id}`
        }
        leading={action.icon}
        trailing={trailing}
        disabled={action.disabled}
        muted={Boolean(action.unavailableMessage)}
        status={action.status}
        pendingLabel={action.pendingLabel}
        successLabel={action.successLabel}
        closeOnSelect={closeOnSelect}
        onSelect={handleSelect}
      >
        {action.label}
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
          testID="changes-actions-menu-trigger"
          accessibilityLabel={t("workspace.header.actions.workspaceActions")}
          className={cn(
            "flex w-12 items-center justify-center gap-1 rounded-md border bg-background text-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-[42px] dark:bg-input/30",
            CONTROL_HEIGHT,
          )}
        >
          <GitBranch size={16} />
          <ChevronDown size={12} className="opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" testID="changes-primary-cta-menu">
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
                testID="changes-primary-cta-caret"
                accessibilityLabel={t("workspace.git.actions.moreOptions")}
                className="flex w-8 items-center justify-center border-l text-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-7 dark:border-input dark:hover:bg-input/50"
              >
                <ChevronDown size={16} className="text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" testID="changes-primary-cta-menu">
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
            testID="changes-overflow-menu"
            accessibilityLabel={t("workspace.git.actions.moreActions")}
            className={cn(
              "-mr-2 flex w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted aria-expanded:bg-muted md:w-7",
              CONTROL_HEIGHT,
            )}
          >
            <MoreVertical size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={220} testID="changes-overflow-content">
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
