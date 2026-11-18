import { isWailsDesktopContainer } from "@/utils/wails";

const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function openInDesktop(url: string): Promise<boolean> {
  try {
    const response = await fetch("/_byspace/desktop/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  // Forge-supplied URLs (check target_url, job links) reach this sink, so refuse anything that is
  // not plain http(s) instead of handing it to window.open.
  if (!isAllowedExternalUrl(url)) {
    return;
  }

  // The desktop webview would navigate in place and replace the app with the page; the native
  // shell hands the URL to the system browser instead. A browser or PWA keeps window.open.
  if (isWailsDesktopContainer() && (await openInDesktop(url))) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
