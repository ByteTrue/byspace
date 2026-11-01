// Override of packages/app/src/tool-calls/detail-level/overview/sheet.tsx: a folded run of tool
// calls on a phone, in a bottom drawer that keeps the newest call in view.
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Drawer, DrawerContent, DrawerTitle } from "~/components/ui/drawer";

export function OverviewToolCallGroupSheet({
  visible,
  summary,
  children,
  onClose,
}: {
  visible: boolean;
  summary: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [children, visible]);
  return (
    <Drawer open={visible} onOpenChange={handleOpenChange}>
      <DrawerContent
        className="h-[60vh] bg-muted data-[vaul-drawer-direction=bottom]:max-h-[95vh]"
        overlayClassName="bg-black/50"
      >
        <div className="flex min-h-0 flex-1 flex-col bg-muted" data-testid="tool-call-group-sheet">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Wrench size={20} className="shrink-0 text-foreground" />
              <DrawerTitle
                className="line-clamp-2 min-w-0 flex-1 text-sm font-medium text-foreground"
                data-testid="tool-call-group-sheet-summary"
              >
                {summary}
              </DrawerTitle>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.actions.close")}
              data-testid="tool-call-group-sheet-close"
              className="p-2 text-muted-foreground"
            >
              <X size={20} />
            </button>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-[13px] py-2">{children}</div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
