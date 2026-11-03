// Port of archive/expo-app:packages/app/src/components/rewind/rewind-menu.tsx: the undo-arrow menu under a
// user message — rewind the conversation, the files, or both.
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { FileText, Layers, MessageSquare, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentCapabilityFlags } from "@bytetrue/protocol/agent-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  type RewindMode,
  useRewindCapabilities,
} from "@/components/rewind/use-rewind-capabilities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { keepOpen } from "~/components/menu-kit";

export type { RewindMode };

const ICONS: Record<RewindMode, ReactElement> = {
  conversation: <MessageSquare size={16} />,
  files: <FileText size={16} />,
  both: <Layers size={16} />,
};

export const RewindMenu = memo(function RewindMenu({
  capabilities,
  rewoundText,
  onRewind,
  isPending: isPendingProp = false,
  testID = "rewind-menu",
}: {
  capabilities: AgentCapabilityFlags;
  rewoundText: string;
  onRewind: (input: { mode: RewindMode; rewoundText: string }) => Promise<void> | void;
  isPending?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const rewindLabels = useMemo(
    () => ({
      conversation: t("rewind.actions.conversation"),
      files: t("rewind.actions.files"),
      both: t("rewind.actions.both"),
    }),
    [t],
  );
  const items = useRewindCapabilities(capabilities, rewindLabels);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<RewindMode | null>(null);
  const isLocked = isPendingProp || pendingMode !== null;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && pendingMode !== null) return;
      setIsOpen(next);
    },
    [pendingMode],
  );
  const handleSelect = useCallback(
    (mode: RewindMode) => async () => {
      if (isLocked) return;
      setPendingMode(mode);
      try {
        await onRewind({ mode, rewoundText });
      } catch {
        // useRewindAgentMutation owns the toast; the menu only owns flow state.
      } finally {
        setPendingMode(null);
        setIsOpen(false);
      }
    },
    [isLocked, onRewind, rewoundText],
  );
  if (items.length === 0) return null;
  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("rewind.tooltip")}
              disabled={isLocked}
              data-testid={`${testID}-trigger`}
            >
              <Undo2 />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {t("rewind.tooltip")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side="bottom"
        data-testid={`${testID}-content`}
        className="w-max min-w-[220px]"
        onCloseAutoFocus={keepFocusElsewhere}
      >
        <div className="px-3 py-2 text-xs text-muted-foreground">{t("rewind.warning")}</div>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.mode}
            disabled={isLocked}
            onSelect={keepOpen(handleSelect(item.mode))}
            data-testid={item.testID}
          >
            {pendingMode === item.mode ? <Spinner /> : ICONS[item.mode]}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
