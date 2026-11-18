import { isWailsDesktopContainer } from "@/utils/wails";

type WailsEventListener = (event: { name: string; data?: unknown }) => void;
interface WailsRuntime {
  Events?: { On?: (name: string, callback: WailsEventListener) => () => void };
}
type WailsWindow = Window & { wails?: WailsRuntime };

/** The native Windows events also fire for keyboard shortcuts and snap, not only our buttons. */
async function readNativeWindowState(): Promise<boolean | null> {
  const response = await fetch("/_byspace/desktop/window", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "query" }),
  });
  const state = (await response.json()) as { maximized?: boolean };
  return typeof state.maximized === "boolean" ? state.maximized : null;
}

export function onWindowsWindowMaximizedChange(callback: (maximized: boolean) => void): () => void {
  if (
    typeof window === "undefined" ||
    !isWailsDesktopContainer() ||
    !/windows/i.test(window.navigator.userAgent)
  ) {
    return () => {};
  }
  const events = (window as WailsWindow).wails?.Events;
  if (!events?.On) return () => {};
  let active = true;
  let receivedNativeEvent = false;
  const dispose = events.On("byspace:window-maximized", (event) => {
    receivedNativeEvent = true;
    callback(event.data === true);
  });
  const readInitialState = async () => {
    try {
      const maximized = await readNativeWindowState();
      if (active && !receivedNativeEvent && maximized !== null) callback(maximized);
    } catch {
      // The next native event still updates the control if the query is unavailable.
    }
  };
  void readInitialState();
  return () => {
    active = false;
    dispose();
  };
}
