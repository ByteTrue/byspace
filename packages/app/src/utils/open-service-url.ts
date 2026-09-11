import { loadAppSettingsFromStorage, type ServiceUrlBehavior } from "@/hooks/use-settings";
import { openExternalUrl } from "@/utils/open-external-url";

export interface OpenServiceUrlOptions {
  openInApp?: (url: string) => void;
}

export async function openServiceUrl(url: string, options?: OpenServiceUrlOptions): Promise<void> {
  const openInApp = options?.openInApp;
  if (!openInApp) {
    await openExternalUrl(url);
    return;
  }

  const behavior = await resolveBehavior(url);
  if (behavior === "in-app") {
    openInApp(url);
    return;
  }
  await openExternalUrl(url);
}

async function resolveBehavior(_url: string): Promise<Exclude<ServiceUrlBehavior, "ask">> {
  const settings = await loadAppSettingsFromStorage();
  if (settings.serviceUrlBehavior === "in-app" || settings.serviceUrlBehavior === "external") {
    return settings.serviceUrlBehavior;
  }

  // The "ask" dialog was desktop-only and is retired (issue 025 A3).
  return "external";
}
