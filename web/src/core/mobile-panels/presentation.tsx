// Port of packages/app/src/mobile-panels/presentation.tsx: a full-width panel over the page with
// a 50% black backdrop under it. The runtime (mobile-panels/provider.tsx) moves both from
// the shared position; React only decides what the overlay holds and whether it is interactive,
// which it is once the panel has settled open.
import type { ReactNode } from "react";
import { usePanelStore } from "@/stores/panel-store";
import { cn } from "cn";
import {
  useIsMobilePanelActive,
  useMobileOverlayPart,
  type MobileOverlayPanel,
} from "@/mobile-panels/provider";

export function MobilePanelOverlay({
  children,
  panel,
  className,
  testID,
}: {
  children: ReactNode;
  panel: MobileOverlayPanel;
  className?: string;
  testID?: string;
}) {
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const isOpen = useIsMobilePanelActive(panel);
  const rootRef = useMobileOverlayPart(panel, "root");
  const backdropRef = useMobileOverlayPart(panel, "backdrop");
  const panelRef = useMobileOverlayPart(panel, "panel");

  return (
    // Hidden until the runtime shows it; it writes display, transform and opacity itself.
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 hidden"
      aria-hidden={!isOpen}
      inert={!isOpen}
      data-mobile-panel={panel}
    >
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/50 opacity-0"
        onClick={showMobileAgent}
        data-testid={isOpen ? `${panel}-backdrop` : undefined}
      />
      <div
        ref={panelRef}
        className={cn(
          "absolute inset-y-0 w-full touch-pan-y overflow-hidden",
          panel === "agent-list" ? "left-0" : "right-0",
          className,
        )}
        data-testid={testID}
      >
        {children}
      </div>
    </div>
  );
}
