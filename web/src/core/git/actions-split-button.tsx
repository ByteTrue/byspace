// Port of archive/expo-app:packages/app/src/git/actions-split-button.tsx: the header's git split button
// (primary action, a caret menu of secondary actions, and a "more" menu), or a single menu
// trigger when space is short. Same actions and test IDs; shadcn view.
import { ButtonGroup } from "~/components/ui/button-group";
import { Button } from "~/components/ui/button";
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
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="default"
            data-testid="changes-actions-menu-trigger"
            aria-label={t("workspace.header.actions.workspaceActions")}
          >
            <GitBranch size={16} />
            <ChevronDown size={12} className="opacity-70" />
          </Button>
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
        <ButtonGroup>
          <Button
            variant="outline"
            size={hideLabels ? "icon" : "default"}
            data-testid="changes-primary-cta"
            onClick={handlePrimaryPress}
            disabled={primary.disabled}
            aria-label={primary.label}
          >
            {primary.status === "pending" ? <Spinner /> : primary.icon}
            {hideLabels ? null : primaryLabel}
          </Button>
          {gitActions.secondary.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  data-testid="changes-primary-cta-caret"
                  aria-label={t("workspace.git.actions.moreOptions")}
                >
                  <ChevronDown />
                </Button>
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
        </ButtonGroup>
      ) : null}
      {gitActions.menu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="changes-overflow-menu"
              aria-label={t("workspace.git.actions.moreActions")}
              className="-mr-2"
            >
              <MoreVertical size={16} />
            </Button>
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
