// Port of archive/expo-app:packages/app/src/components/desktop-window-titlebar.tsx: the framed content card
// (6px from the window edges, 12px radius, 1px border) and, in the Windows desktop app's frameless
// window, the 36px title bar above it with minimize, maximize and close.
import { Button } from "~/components/ui/button";
import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { cn } from "cn";

/** Running inside the Wails desktop container (not a phone's Wails webview). */
export function isWailsDesktopShell(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const isWailsOrigin =
    window.location?.protocol === "wails:" ||
    window.location?.hostname === "wails.localhost" ||
    "wails" in window;
  if (!isWailsOrigin) {
    return false;
  }
  const ua = window.navigator?.userAgent ?? "";
  return !/android|iphone|ipad|ipod/i.test(ua);
}

export function isWindowsWailsDesktop(): boolean {
  if (!isWailsDesktopShell()) {
    return false;
  }
  const ua = window.navigator?.userAgent ?? "";
  return /windows/i.test(ua);
}

function sendWindowAction(action: "minimize" | "maximize" | "close") {
  void fetch("/_byspace/desktop/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowAction: action }),
  }).catch(() => undefined);
}

export function DesktopWindowTitleBar({ showLeadingNav }: { showLeadingNav: boolean }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const handleMinimize = useCallback(() => sendWindowAction("minimize"), []);
  const handleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
    sendWindowAction("maximize");
  }, []);
  const handleClose = useCallback(() => sendWindowAction("close"), []);

  return (
    <div
      className="flex h-9 min-h-9 items-center justify-between pl-3 select-none"
      data-wails-drag="true"
      data-testid="desktop-window-titlebar"
    >
      <div className="flex h-full min-w-0 flex-1 items-center" data-wails-drag="true">
        {/* The collapsed sidebar's way back; the app menu became the sidebar's nav rows. */}
        {showLeadingNav ? <SidebarMenuToggle host="content" /> : null}
      </div>
      <div className="flex items-center gap-1 pr-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Minimize"
          onClick={handleMinimize}
          data-testid="window-control-minimize"
        >
          <Minus />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={handleMaximize}
          data-testid="window-control-maximize"
        >
          {isMaximized ? <Copy /> : <Square />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={handleClose}
          data-testid="window-control-close"
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

/**
 * The content card: on macOS and the web 6px from the top, right and bottom (and left when no
 * sidebar is beside it); in the Windows desktop app the title bar sits above it instead of the
 * top inset.
 */
export function DesktopContentFrame({
  enabled,
  sidebarCollapsed,
  showCollapsedSidebarNav = false,
  cardStyle,
  testID,
  children,
}: {
  enabled: boolean;
  sidebarCollapsed: boolean;
  showCollapsedSidebarNav?: boolean;
  cardStyle?: CSSProperties;
  testID?: string;
  children: ReactNode;
}) {
  const hasWindowsTitleBar = enabled && isWindowsWailsDesktop();
  // A fixed two-element depth either way, so toggling the frame never remounts the content.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasWindowsTitleBar ? (
        <DesktopWindowTitleBar showLeadingNav={sidebarCollapsed && showCollapsedSidebarNav} />
      ) : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          enabled && "mr-1.5 mb-1.5 overflow-hidden rounded-[12px] border bg-background",
          enabled && !hasWindowsTitleBar && "mt-1.5",
          enabled && sidebarCollapsed && "ml-1.5",
        )}
        style={cardStyle}
        data-testid={testID}
      >
        {children}
      </div>
    </div>
  );
}
