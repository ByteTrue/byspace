export type BySpaceReleaseChannel = "stable" | "beta";

export const STABLE_APP_BASE_URL = "https://app.byspace.cc.cd";
export const BETA_APP_BASE_URL = "https://app-beta.byspace.cc.cd";

export function resolveBySpaceReleaseChannel(version: string): BySpaceReleaseChannel {
  return version.includes("-") ? "beta" : "stable";
}

export function resolveBySpaceHostedAppBaseUrl(version: string): string {
  return resolveBySpaceReleaseChannel(version) === "beta" ? BETA_APP_BASE_URL : STABLE_APP_BASE_URL;
}

export function isBySpaceHostedAppBaseUrl(value: string | undefined): boolean {
  return value === STABLE_APP_BASE_URL || value === BETA_APP_BASE_URL;
}
