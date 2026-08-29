import { openExternalUrl } from "@/utils/open-external-url";

export interface OpenServiceUrlOptions {
  openInApp?: (url: string) => void;
}

export async function openServiceUrl(url: string, _options?: OpenServiceUrlOptions): Promise<void> {
  await openExternalUrl(url);
}
