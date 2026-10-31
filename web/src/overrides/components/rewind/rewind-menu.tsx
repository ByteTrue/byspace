// Override of packages/app/src/components/rewind/rewind-menu.tsx: the undo-arrow menu under a
// user message — rewind the conversation, the files, or both.
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { FileText, Layers, MessageSquare, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentCapabilityFlags } from "@bytetrue/protocol/agent-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type RewindMode,
  useRewindCapabilities,
} from "@/components/rewind/use-rewind-capabilities";

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
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            accessibilityLabel={t("rewind.tooltip")}
            disabled={isLocked}
            testID={`${testID}-trigger`}
            className="flex items-center justify-center self-center p-1 text-muted-foreground hover:text-foreground disabled:opacity-50 aria-expanded:text-foreground"
          >
            <Undo2 size={16} />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          {t("rewind.tooltip")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" minWidth={220} side="bottom" testID={`${testID}-content`}>
        <div className="px-3 py-2 text-xs text-muted-foreground">{t("rewind.warning")}</div>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.mode}
            closeOnSelect={false}
            disabled={isLocked && pendingMode !== item.mode}
            leading={ICONS[item.mode]}
            onSelect={handleSelect(item.mode)}
            status={pendingMode === item.mode ? "pending" : undefined}
            testID={item.testID}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
