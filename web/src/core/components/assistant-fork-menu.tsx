// Port of archive/expo-app:packages/app/src/components/assistant-fork-menu.tsx: fork the conversation from an
// assistant turn into a new tab or a new workspace.
import { memo, useCallback, useState } from "react";
import { Split } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { keepOpen } from "~/components/menu-kit";

export type AssistantForkTarget = "tab" | "workspace";

const FORK_ICON = <Split size={14} className="text-foreground" />;

export const AssistantForkMenu = memo(function AssistantForkMenu({
  onFork,
  testID = "assistant-fork-menu",
}: {
  onFork: (target: AssistantForkTarget) => Promise<void> | void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<AssistantForkTarget | null>(null);
  const isLocked = pendingTarget !== null;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && pendingTarget !== null) return;
      setIsOpen(next);
    },
    [pendingTarget],
  );
  const handleSelect = useCallback(
    (target: AssistantForkTarget) => async () => {
      if (isLocked) return;
      setPendingTarget(target);
      try {
        await onFork(target);
      } finally {
        setPendingTarget(null);
        setIsOpen(false);
      }
    },
    [isLocked, onFork],
  );
  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("message.actions.forkMenu")}
              disabled={isLocked}
              data-testid={`${testID}-trigger`}
            >
              <Split />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {t("message.actions.forkMenu")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
        data-testid={`${testID}-content`}
        className="w-max min-w-[220px]"
        onCloseAutoFocus={keepFocusElsewhere}
      >
        <DropdownMenuItem
          disabled={isLocked}
          onSelect={keepOpen(handleSelect("tab"))}
          data-testid={`${testID}-new-tab`}
        >
          {pendingTarget === "tab" ? <Spinner /> : FORK_ICON}
          {t("message.actions.forkInNewTab")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isLocked}
          onSelect={keepOpen(handleSelect("workspace"))}
          data-testid={`${testID}-new-workspace`}
        >
          {pendingTarget === "workspace" ? <Spinner /> : FORK_ICON}
          {t("message.actions.forkInNewWorkspace")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
