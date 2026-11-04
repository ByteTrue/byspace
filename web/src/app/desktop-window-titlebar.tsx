import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { isWailsDesktopContainer } from "@/utils/wails";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { cn } from "cn";

const ignoreOpenChange = () => {};

/** The Windows desktop shell only: macOS keeps its native traffic lights, Android is excluded by
 * `isWailsDesktopContainer`'s UA check. */
export function isWindowsDesktopShell(): boolean {
  return isWailsDesktopContainer() && /windows/i.test(window.navigator?.userAgent ?? "");
}

function sendWindowAction(action: "minimize" | "maximize" | "close") {
  void fetch("/_byspace/desktop/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowAction: action }),
  }).catch(() => undefined);
}

const minimize = () => sendWindowAction("minimize");
const close = () => sendWindowAction("close");

/**
 * The main column for the Windows L-shell: the 36px titlebar strip rides on top of the framed
 * card, and the card drops its top margin to sit right below it. Everywhere else this is the
 * plain SidebarInset with its existing classes.
 */
export function WindowsShellMain({
  framed,
  compact,
  children,
}: {
  framed: boolean;
  compact: boolean;
  children: ReactNode;
}) {
  const windowsShell = framed && !compact && isWindowsDesktopShell();
  return (
    <SidebarInset
      className={cn(
        "min-h-0 overflow-hidden",
        !framed && "block flex-1 bg-transparent",
        windowsShell && "md:peer-data-[variant=inset]:mt-0",
      )}
    >
      {children}
    </SidebarInset>
  );
}

/** True only in the Windows desktop client's non-compact layout, where the shell adds the
 * full-width titlebar strip above the sidebar+content row. */
export function usesWindowsTitleBarShell(compact: boolean): boolean {
  return !compact && isWindowsDesktopShell();
}

/**
 * The Windows L-shell wraps the sidebar row in a column so the titlebar strip spans the full
 * width (its controls sit at the window's top-right), sidebar + framed card below. Everywhere
 * else it is the plain SidebarProvider row, unchanged; `className="contents"` keeps the DOM
 * out of the layout when the shell is off.
 */
export function WindowsShellFrame({
  shell,
  titleBar,
  open,
  style,
  sidebar,
  inset,
  children,
}: {
  shell: boolean;
  titleBar: ReactNode;
  open: boolean;
  style: CSSProperties;
  sidebar: ReactNode;
  inset: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={shell ? "flex h-svh flex-col bg-sidebar" : "contents"}>
      {shell ? titleBar : null}
      <SidebarProvider
        open={open}
        onOpenChange={ignoreOpenChange}
        style={style}
        className={cn(
          "data-resizing:**:data-[slot=sidebar-container]:transition-none data-resizing:**:data-[slot=sidebar-gap]:transition-none",
          shell ? "min-h-0 flex-1" : "h-svh",
        )}
        // No width animation while the rail drags: the sidebar follows the pointer.
      >
        {children}
        {sidebar}
        {inset}
      </SidebarProvider>
    </div>
  );
}

/**
 * The 36px strip above the framed content card on the Windows frameless window: drag region,
 * double-click zoom, and the — □ ✕ controls. Sits on the sidebar backdrop so the card below it
 * forms the Feishu-style L-shaped shell (byissue/issues/2026-10-30-x-ff-agcopilot-framed-card-
 * window-shell.md).
 */
export function DesktopWindowTitleBar({
  showLeadingNav,
  onToggleSidebar,
}: {
  showLeadingNav: boolean;
  onToggleSidebar: () => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);

  const toggleMaximize = useCallback((event: MouseEvent) => {
    event.preventDefault();
    setIsMaximized((prev) => !prev);
    sendWindowAction("maximize");
  }, []);

  return (
    <div
      data-wails-drag="true"
      data-testid="desktop-window-titlebar"
      onDoubleClick={toggleMaximize}
      className="flex h-9 min-h-9 shrink-0 items-center justify-between pl-3 select-none"
    >
      <div data-wails-drag="true" className="flex h-full min-w-0 flex-1 items-center gap-1">
        {showLeadingNav ? (
          <button
            type="button"
            aria-label="Show sidebar"
            data-testid="window-titlebar-sidebar-toggle"
            onClick={onToggleSidebar}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
              <path d="M5.5 2.5V13.5" stroke="currentColor" />
            </svg>
          </button>
        ) : null}
      </div>
      <div data-wails-drag="true" className="flex h-full items-stretch">
        <button
          type="button"
          aria-label="Minimize"
          data-testid="window-control-minimize"
          onClick={minimize}
          className="flex w-11 items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          data-testid="window-control-maximize"
          onClick={toggleMaximize}
          className="flex w-11 items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          {isMaximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          aria-label="Close"
          data-testid="window-control-close"
          onClick={close}
          className="flex w-11 items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
