const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(new URL(url).protocol);
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

  window.open(url, "_blank", "noopener,noreferrer");
}
