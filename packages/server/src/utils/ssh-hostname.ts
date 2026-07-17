import { normalizeHost } from "@bytetrue/byspace-protocol/git-remote";
import { LRUCache } from "lru-cache";
import { findExecutable } from "../executable-resolution/executable-resolution.js";
import { execCommand } from "./spawn.js";

export type SshHostnameResolver = (host: string) => Promise<string | null>;

const SSH_HOSTNAME_RESOLVE_TIMEOUT_MS = 5_000;
const SSH_HOSTNAME_CACHE_MAX = 512;
let sshExecutableLookup: Promise<string | null> | null = null;

export function createSshHostnameResolver(
  options: {
    lookup?: (host: string) => Promise<string | null>;
  } = {},
): SshHostnameResolver {
  const lookup = options.lookup ?? runSshHostnameLookup;
  const cache = new LRUCache<string, Promise<string | null>>({ max: SSH_HOSTNAME_CACHE_MAX });
  return async (host) => {
    const normalized = normalizeHost(host);
    if (!normalized) return null;
    const cached = cache.get(normalized);
    if (cached) return cached;
    const resolution = lookup(normalized);
    cache.set(normalized, resolution);
    return resolution;
  };
}

/** Resolve an SSH host alias through `ssh -G`, with a bounded daemon-lifetime cache. */
export const resolveSshHostname = createSshHostnameResolver();

async function runSshHostnameLookup(host: string): Promise<string | null> {
  sshExecutableLookup ??= findExecutable("ssh");
  const sshPath = await sshExecutableLookup;
  if (!sshPath) return null;

  try {
    const { stdout } = await execCommand(sshPath, ["-G", host], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 1024 * 1024,
      timeout: SSH_HOSTNAME_RESOLVE_TIMEOUT_MS,
    });
    return parseSshHostname(stdout);
  } catch {
    return null;
  }
}

function parseSshHostname(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u)) {
    const [key, value] = line.trim().split(/\s+/u);
    if (key?.toLowerCase() !== "hostname") continue;
    const normalized = normalizeHost(value ?? "");
    if (normalized) return normalized;
  }
  return null;
}
