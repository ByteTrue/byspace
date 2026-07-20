export type BySpaceReleaseChannel = "stable" | "beta";
export type BySpaceNpmDistTag = "latest" | "beta";

export interface BySpaceHostedRelease {
  channel: BySpaceReleaseChannel;
  npmDistTag: BySpaceNpmDistTag;
  appBaseUrl: string;
  relayEndpoint: string;
}

export const STABLE_HOSTED_RELEASE: BySpaceHostedRelease = {
  channel: "stable",
  npmDistTag: "latest",
  appBaseUrl: "https://byspace.pages.dev",
  relayEndpoint: "byspace-relay.bytetrue.workers.dev:443",
};

export const BETA_HOSTED_RELEASE: BySpaceHostedRelease = {
  channel: "beta",
  npmDistTag: "beta",
  appBaseUrl: "https://byspace-beta.pages.dev",
  relayEndpoint: "byspace-relay-beta.bytetrue.workers.dev:443",
};

const VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function resolveBySpaceHostedRelease(version: string): BySpaceHostedRelease {
  const normalized = version.trim();
  const match = VERSION_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(`Invalid BySpace release version: ${version}`);
  }
  return match[1] ? BETA_HOSTED_RELEASE : STABLE_HOSTED_RELEASE;
}

export function isBySpaceHostedAppBaseUrl(value: string | undefined): boolean {
  return value === STABLE_HOSTED_RELEASE.appBaseUrl || value === BETA_HOSTED_RELEASE.appBaseUrl;
}

export function isBySpaceHostedRelayEndpoint(value: string | undefined): boolean {
  return (
    value === STABLE_HOSTED_RELEASE.relayEndpoint || value === BETA_HOSTED_RELEASE.relayEndpoint
  );
}
