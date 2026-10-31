// Override of packages/app/src/mobile-panels/provider.tsx. On a phone the Expo app slides its
// panels (sidebar, agent, explorer) with gestures and reports the panel that settled; the web shell
// shows the sidebar and the explorer as sheets that open with the panel store, so the active panel
// is the store's and there are no gestures to block.
import type { ReactNode } from "react";
import { usePanelStore, type MobilePanelView } from "@/stores/panel-store";

export function MobilePanelsProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useIsMobilePanelActive(panel: MobilePanelView): boolean {
  return usePanelStore((state) => state.mobilePanel.target === panel);
}

export function useBlockMobilePanelOpenGestures(_blocked: boolean): void {}
