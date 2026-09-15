import { openExternalUrl } from "@/utils/open-external-url";

/**
 * Opens a service URL. The "in-app browser" behavior was desktop-only and is
 * retired (issue 025 A3); every service URL opens externally now.
 */
export async function openServiceUrl(url: string): Promise<void> {
  await openExternalUrl(url);
}
