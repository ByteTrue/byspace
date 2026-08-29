import {
  resolveBySpaceHostedRelease,
  STABLE_HOSTED_RELEASE,
  type BySpaceHostedRelease,
} from "@bytetrue/byspace-protocol/release-channel";
import { resolveAppVersion } from "./app-version";

export function resolveAppHostedRelease(): BySpaceHostedRelease {
  const version = resolveAppVersion();
  return version === null ? STABLE_HOSTED_RELEASE : resolveBySpaceHostedRelease(version);
}
