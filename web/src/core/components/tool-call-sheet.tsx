// On a phone a tool call opens in a shadcn bottom Drawer instead of expanding inline.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import type { ToolCallIconComponent } from "@/utils/tool-call-icon";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";

export interface ToolCallSheetData {
  toolName: string;
  displayName: string;
  summary?: string;
  detail?: ToolCallDetail;
  errorText?: string;
  icon: ToolCallIconComponent;
  showLoadingSkeleton?: boolean;
}

interface ToolCallSheetContextValue {
  openToolCall: (data: ToolCallSheetData) => void;
  closeToolCall: () => void;
}

const ToolCallSheetContext = createContext<ToolCallSheetContextValue | null>(null);

export function useToolCallSheet(): ToolCallSheetContextValue {
  const context = useContext(ToolCallSheetContext);
  if (!context) throw new Error("useToolCallSheet must be used within a ToolCallSheetProvider");
  return context;
}

export function ToolCallSheetProvider({ children }: { children: ReactNode }) {
  const [sheetData, setSheetData] = useState<ToolCallSheetData | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const openToolCall = useCallback((data: ToolCallSheetData) => {
    setSheetData(data);
    setIsSheetOpen(true);
  }, []);
  const closeToolCall = useCallback(() => setIsSheetOpen(false), []);
  const handleAnimationEnd = useCallback((open: boolean) => {
    if (!open) setSheetData(null);
  }, []);
  const contextValue = useMemo(
    () => ({ openToolCall, closeToolCall }),
    [openToolCall, closeToolCall],
  );
  return (
    <ToolCallSheetContext value={contextValue}>
      {children}
      <Drawer open={isSheetOpen} onOpenChange={setIsSheetOpen} onAnimationEnd={handleAnimationEnd}>
        <DrawerContent aria-describedby={undefined}>
          {sheetData ? <ToolCallSheetContent data={sheetData} /> : null}
        </DrawerContent>
      </Drawer>
    </ToolCallSheetContext>
  );
}

function ToolCallSheetContent({ data }: { data: ToolCallSheetData }) {
  const { t } = useTranslation();
  const { toolName, displayName, detail, errorText, icon: Icon, showLoadingSkeleton } = data;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader className="flex-row items-center gap-2">
        <Icon size={16} color="currentColor" />
        <DrawerTitle className="min-w-0 flex-1 truncate text-left">{displayName}</DrawerTitle>
        <DrawerClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.actions.close")}
            data-testid="tool-call-sheet-close"
          >
            <X />
          </Button>
        </DrawerClose>
      </DrawerHeader>
      {/* The page colour: detail blocks are flat on their background. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ToolCallDetailsContent
          toolName={toolName}
          detail={detail}
          errorText={errorText}
          fillAvailableHeight
          showLoadingSkeleton={showLoadingSkeleton}
        />
      </div>
    </div>
  );
}
