// Override of packages/app/src/components/tool-call-sheet.tsx: on a phone a tool call opens in a
// bottom drawer (60% of the screen, dragged up to 95%) instead of expanding inline.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import type { ToolCallIconComponent } from "@/utils/tool-call-icon";
import { Drawer, DrawerContent, DrawerTitle } from "~/components/ui/drawer";

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

const SNAP_POINTS = [0.6, 0.95];

export function ToolCallSheetProvider({ children }: { children: ReactNode }) {
  const [sheetData, setSheetData] = useState<ToolCallSheetData | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]);
  const openToolCall = useCallback((data: ToolCallSheetData) => {
    setSheetData(data);
    setSnap(SNAP_POINTS[0]);
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
      <Drawer
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        snapPoints={SNAP_POINTS}
        fadeFromIndex={0}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        onAnimationEnd={handleAnimationEnd}
      >
        <DrawerContent className="h-[95vh] bg-muted data-[vaul-drawer-direction=bottom]:max-h-[95vh]">
          {sheetData ? <ToolCallSheetContent data={sheetData} onClose={closeToolCall} /> : null}
        </DrawerContent>
      </Drawer>
    </ToolCallSheetContext>
  );
}

function ToolCallSheetContent({ data, onClose }: { data: ToolCallSheetData; onClose: () => void }) {
  const { t } = useTranslation();
  const { toolName, displayName, detail, errorText, icon: Icon, showLoadingSkeleton } = data;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex shrink-0 text-foreground">
            <Icon size={20} color="currentColor" />
          </span>
          <DrawerTitle className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {displayName}
          </DrawerTitle>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.actions.close")}
          data-testid="tool-call-sheet-close"
          className="p-2 text-muted-foreground"
        >
          <X size={20} />
        </button>
      </div>
      {/* The page colour: detail blocks are flat on their background. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card">
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
