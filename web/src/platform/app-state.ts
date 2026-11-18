// Whether the page is in the foreground, from the Page Visibility API. "inactive" is in the type
// for code that handles it; the browser only reports active and background.
export type AppStateStatus = "active" | "background" | "inactive";
type AppStateEvent = "change" | "focus" | "blur";

function currentAppState(): AppStateStatus {
  return document.visibilityState === "hidden" ? "background" : "active";
}

export const AppState = {
  isAvailable: true,
  get currentState(): AppStateStatus {
    return currentAppState();
  },
  addEventListener(type: AppStateEvent, handler: (state: AppStateStatus) => void) {
    const listener = () => handler(currentAppState());
    if (type === "change") {
      document.addEventListener("visibilitychange", listener);
      return { remove: () => document.removeEventListener("visibilitychange", listener) };
    }
    window.addEventListener(type, listener);
    return { remove: () => window.removeEventListener(type, listener) };
  },
};
