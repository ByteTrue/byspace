import {
  isGitHubHost,
  parseGitHubRemoteIdentity,
  parseGitRemoteLocation,
  type GitHubRemoteIdentity as ResolvedGitHubRemoteIdentity,
} from "@bytetrue/byspace-protocol/git-remote";
import { resolveSshHostname, type SshHostnameResolver } from "./ssh-hostname.js";

export type { SshHostnameResolver } from "./ssh-hostname.js";
export { resolveSshHostname } from "./ssh-hostname.js";
export {
  parseGitHubRemoteUrl,
  type GitHubRemoteIdentity,
} from "@bytetrue/byspace-protocol/git-remote";

export async function resolveGitHubRemote(input: {
  remoteUrl: string;
  resolveSshHostname?: SshHostnameResolver;
}): Promise<ResolvedGitHubRemoteIdentity | null> {
  const location = parseGitRemoteLocation(input.remoteUrl);
  if (!location) return null;
  if (isGitHubHost(location.host)) return parseGitHubRemoteIdentity(location.path);
  if (location.transport !== "scp" && location.transport !== "ssh") return null;

  const resolvedHost = await (input.resolveSshHostname ?? resolveSshHostname)(location.host);
  if (!resolvedHost || !isGitHubHost(resolvedHost)) return null;
  return parseGitHubRemoteIdentity(location.path);
}
