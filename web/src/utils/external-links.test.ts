// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler } from "./external-links";
import { openExternalUrl } from "./open-external-url";

const disposers: Array<() => void> = [];

function desktopShell(): void {
  (window as { wails?: unknown }).wails = {};
}

function renderAnchor(href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = "link";
  document.body.appendChild(anchor);
  return anchor;
}

function click(anchor: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  anchor.dispatchEvent(event);
  return event;
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async () => ({ ok: true }) as Response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

// Registered after the external-link handler, so that handler still sees an unhandled click.
// Only suppresses jsdom's own navigation; it cannot hide a missing guard in our handler.
function preventBrowserNavigation(): void {
  const prevent = (event: Event) => event.preventDefault();
  document.addEventListener("click", prevent);
  disposers.push(() => document.removeEventListener("click", prevent));
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  delete (window as { wails?: unknown }).wails;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("installExternalLinkHandler", () => {
  it("opens an external anchor through the desktop shell instead of the webview", () => {
    desktopShell();
    const fetchSpy = stubFetch();
    disposers.push(installExternalLinkHandler());

    const event = click(renderAnchor("https://example.com/docs"));

    expect(event.defaultPrevented).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/_byspace/desktop/open-url",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("leaves the app's own routes to the router", () => {
    desktopShell();
    const fetchSpy = stubFetch();
    disposers.push(installExternalLinkHandler());

    preventBrowserNavigation();

    const anchor = renderAnchor("/settings/hosts");
    click(anchor);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not open a link a component already handled", () => {
    desktopShell();
    const fetchSpy = stubFetch();
    disposers.push(installExternalLinkHandler());

    const anchor = renderAnchor("https://example.com/docs");
    // A React link handler (shared markdown renderer) prevents the default and opens the URL
    // itself; the document listener must not open it a second time.
    anchor.addEventListener("click", (event) => event.preventDefault());
    click(anchor);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("leaves download links to the app", () => {
    desktopShell();
    const fetchSpy = stubFetch();
    disposers.push(installExternalLinkHandler());
    preventBrowserNavigation();

    const anchor = renderAnchor("https://example.com/file.zip");
    anchor.setAttribute("download", "");
    click(anchor);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not touch links outside the desktop app", () => {
    const fetchSpy = stubFetch();
    disposers.push(installExternalLinkHandler());

    const anchor = renderAnchor("https://example.com/docs");
    // Keep jsdom from attempting the navigation the test is not about.
    anchor.addEventListener("click", (event) => event.preventDefault());
    click(anchor);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("openExternalUrl", () => {
  it("hands a link to the desktop shell when one is available", async () => {
    desktopShell();
    const fetchSpy = stubFetch();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl("https://example.com/a");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("opens a new tab in a browser or PWA", async () => {
    const fetchSpy = stubFetch();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl("https://example.com/a");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  });

  it("refuses protocols that are not plain http(s)", async () => {
    desktopShell();
    const fetchSpy = stubFetch();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl("javascript:alert(1)");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
