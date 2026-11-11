import { openExternalUrl } from "@/utils/open-external-url";
import { isWailsDesktopContainer } from "@/utils/wails";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Sends external link clicks to the system browser instead of navigating the webview.
 *
 * Markdown and a few settings rows render plain anchors. In the desktop app an unhandled click
 * replaces the app with that page, and there is no address bar to get back. Router links stay with
 * the router: only a URL outside the app's own origin is intercepted.
 */
export function installExternalLinkHandler(): () => void {
  if (typeof document === "undefined" || !isWailsDesktopContainer()) {
    return () => {};
  }
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target : null;
    const anchor = element?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    // A download is an action the app owns; opening its URL in the browser would cancel it.
    if (anchor.hasAttribute("download")) return;
    let target: URL;
    try {
      target = new URL(anchor.getAttribute("href") ?? "", window.location.href);
    } catch {
      return;
    }
    if (!EXTERNAL_PROTOCOLS.has(target.protocol) || target.origin === window.location.origin) {
      return;
    }
    event.preventDefault();
    void openExternalUrl(target.href);
  };
  // Bubble phase: a component that already handled the link calls preventDefault before this
  // runs, so it is not opened a second time. Capture phase cannot see that.
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
