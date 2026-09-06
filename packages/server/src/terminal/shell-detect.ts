import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, delimiter, isAbsolute, join, posix, win32 } from "node:path";

export interface DetectedShell {
  path: string;
  name: string;
}

export interface ShellCandidate {
  // Absolute path, or a bare name resolved against PATH.
  location: string;
  // Where the candidate came from; only used by tests and logging.
  source: "env" | "dscl" | "etc-shells" | "well-known";
}

export interface DetectShellsOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Overrides candidate discovery; tests inject fixtures here. */
  candidates?: readonly ShellCandidate[];
  /** Overrides /etc/shells reading; tests inject fixture text here. */
  readEtcShells?: () => string | null;
  /** Overrides the macOS login-shell lookup; tests inject fixture text here. */
  readMacUserShell?: () => string | null;
  /** Resolves bare names against PATH. Defaults to PATH walk. */
  resolveOnPath?: (name: string) => string | null;
  exists?: (path: string) => boolean;
}

const WELL_KNOWN_UNIX_SHELLS: readonly ShellCandidate[] = [
  { location: "/bin/bash", source: "well-known" },
  { location: "/bin/zsh", source: "well-known" },
  { location: "/usr/bin/bash", source: "well-known" },
  { location: "/usr/bin/zsh", source: "well-known" },
  { location: "/usr/local/bin/bash", source: "well-known" },
  { location: "/usr/local/bin/zsh", source: "well-known" },
  { location: "/usr/local/bin/fish", source: "well-known" },
  { location: "/opt/homebrew/bin/bash", source: "well-known" },
  { location: "/opt/homebrew/bin/zsh", source: "well-known" },
  { location: "/opt/homebrew/bin/fish", source: "well-known" },
  { location: "/opt/homebrew/bin/nu", source: "well-known" },
  { location: "/usr/local/bin/nu", source: "well-known" },
];

const WELL_KNOWN_WINDOWS_SHELLS: readonly ShellCandidate[] = [
  { location: "pwsh", source: "well-known" },
  { location: "powershell", source: "well-known" },
  { location: "cmd", source: "well-known" },
];

function resolveOnPathVariable(name: string, env: NodeJS.ProcessEnv): string | null {
  const path = env.PATH ?? "";
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function defaultResolveOnPath(env: NodeJS.ProcessEnv): (name: string) => string | null {
  return (name) => resolveOnPathVariable(name, env);
}

/**
 * Parses `/etc/shells` text into candidate paths. Comments and blank lines are
 * skipped; entries must be absolute.
 */
export function parseEtcShells(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && isAbsolute(line));
}

/**
 * Parses `dscl . -read /Users/<user> UserShell` output ("UserShell: /bin/zsh").
 * Returns null when the line is missing or malformed.
 */
export function parseDsclUserShell(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.startsWith("UserShell:"));
  if (!line) {
    return null;
  }
  const value = line.slice("UserShell:".length).trim();
  return isAbsolute(value) ? value : null;
}

/**
 * Runs `dscl . -read /Users/<user> UserShell` and parses the login shell path.
 * Returns null when dscl is unavailable, fails, or the output is unusable —
 * detection degrades to the remaining sources rather than failing.
 */
export async function readMacUserShell(homeDir: string): Promise<string | null> {
  const user = basename(homeDir);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("dscl", [".", "-read", `/Users/${user}`, "UserShell"], (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    return parseDsclUserShell(stdout);
  } catch {
    return null;
  }
}

function toDetectedShell(path: string, platform: NodeJS.Platform): DetectedShell {
  // basename follows the running host; the name must follow the detected
  // platform so backslash paths name correctly in tests run on POSIX hosts.
  const base = platform === "win32" ? win32.basename(path) : posix.basename(path);
  return { path, name: base };
}

/**
 * Resolves and dedupes candidate shell paths into detected shells. Bare names
 * resolve against PATH; duplicates and non-existent paths are dropped.
 */
async function resolveDetectedShells(
  candidates: readonly ShellCandidate[],
  platform: NodeJS.Platform,
  resolveOnPath: (name: string) => string | null,
  exists: (path: string) => boolean,
): Promise<DetectedShell[]> {
  const seen = new Set<string>();
  const shells: DetectedShell[] = [];
  for (const candidate of candidates) {
    const path = isAbsolute(candidate.location)
      ? candidate.location
      : resolveOnPath(candidate.location);
    if (!path || seen.has(path) || !exists(path)) {
      continue;
    }
    seen.add(path);
    shells.push(toDetectedShell(path, platform));
  }
  return shells;
}

async function gatherUnixCandidates(
  options: DetectShellsOptions,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): Promise<ShellCandidate[]> {
  const candidates: ShellCandidate[] = [];
  const envShell = env.SHELL;
  if (envShell && isAbsolute(envShell)) {
    candidates.push({ location: envShell, source: "env" });
  }
  if (platform === "darwin") {
    const userShell = options.readMacUserShell
      ? options.readMacUserShell()
      : await readMacUserShell(homeDir);
    if (userShell) {
      candidates.push({ location: userShell, source: "dscl" });
    }
  }
  const etcShells = options.readEtcShells ? options.readEtcShells() : readEtcShellsFile();
  if (etcShells) {
    for (const entry of parseEtcShells(etcShells)) {
      candidates.push({ location: entry, source: "etc-shells" });
    }
  }
  candidates.push(...WELL_KNOWN_UNIX_SHELLS);
  return candidates;
}

async function gatherCandidates(
  options: DetectShellsOptions,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): Promise<ShellCandidate[]> {
  if (options.candidates) {
    return [...options.candidates];
  }
  if (platform === "win32") {
    return [...WELL_KNOWN_WINDOWS_SHELLS];
  }
  return gatherUnixCandidates(options, platform, env, homeDir);
}

/**
 * Shells installed on this machine, deduped by absolute path, in discovery
 * order: environment shell first (the strongest signal of what the user
 * actually uses), then the macOS login shell, then /etc/shells, then
 * well-known locations. Only paths that exist are returned.
 */
export async function detectInstalledShells(
  options: DetectShellsOptions = {},
): Promise<DetectedShell[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? env.HOME ?? "";
  const exists = options.exists ?? existsSync;
  const resolveOnPath = options.resolveOnPath ?? defaultResolveOnPath(env);

  const candidates = await gatherCandidates(options, platform, env, homeDir);
  return resolveDetectedShells(candidates, platform, resolveOnPath, exists);
}

function readEtcShellsFile(): string | null {
  try {
    return readFileSync("/etc/shells", "utf8");
  } catch {
    return null;
  }
}
