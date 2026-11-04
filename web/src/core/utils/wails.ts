/** Inside a Wails webview: the desktop app or the Android app. */
export function isWailsContainer(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location?.protocol === "wails:" ||
    window.location?.hostname === "wails.localhost" ||
    "wails" in window
  );
}

/** The desktop app (macOS, Windows, Linux), which serves the /_byspace/desktop/* endpoints. */
export function isWailsDesktopContainer(): boolean {
  if (!isWailsContainer()) return false;
  return !/android|iphone|ipad|ipod/i.test(window.navigator?.userAgent ?? "");
}
