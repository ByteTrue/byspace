export const STABLE_APP_BASE_URL = "https://app.byspace.cc.cd";
export const BETA_APP_BASE_URL = "https://app-beta.byspace.cc.cd";

export function resolveBySpaceHostedAppBaseUrl(version: string): string {
  return version.includes("-") ? BETA_APP_BASE_URL : STABLE_APP_BASE_URL;
}

export function isBySpaceHostedAppBaseUrl(value: string | undefined): boolean {
  return value === STABLE_APP_BASE_URL || value === BETA_APP_BASE_URL;
}
