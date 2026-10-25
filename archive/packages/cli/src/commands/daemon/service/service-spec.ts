import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Platform-agnostic description of the daemon service definition. Platform backends
 * (launchd/systemd/Task Scheduler) translate this into their native format.
 *
 * Everything here must be an absolute path or an exact value: service managers do not
 * read shell profiles, so nothing may depend on the login environment at run time.
 */
export interface DaemonServiceSpec {
  /** Reverse-DNS service label, e.g. `cc.cd.byspace.daemon`. */
  label: string;
  /** Absolute path to the node executable that runs the daemon. */
  nodePath: string;
  /** Absolute path to the daemon runner entry (supervisor entrypoint). */
  runnerEntry: string;
  /** Extra arguments passed to the runner. */
  runnerArgs: string[];
  /** Absolute path to the daemon log file. */
  logPath: string;
  /** Environment variables snapshotted at install time. */
  env: Record<string, string>;
}

/**
 * Home directories that macOS `launchctl bootstrap gui/<uid>` reads LaunchAgents from,
 * in check order. XDG overrides the legacy path when it exists.
 */
export function launchAgentDirs(home: string): string[] {
  const xdg = process.env.XDG_CONFIG_HOME;
  const dirs = [];
  if (xdg) dirs.push(path.join(xdg, "LaunchAgents"));
  dirs.push(path.join(home, "Library", "LaunchAgents"));
  return dirs;
}

/** Absolute plist path for the label, resolved against the first existing dir. */
export function launchdPlistPath(label: string, home: string): string {
  for (const dir of launchAgentDirs(home)) {
    if (existsSync(dir)) return path.join(dir, `${label}.plist`);
  }
  return path.join(home, "Library", "LaunchAgents", `${label}.plist`);
}

/**
 * True when a plist for the label exists in any LaunchAgents dir. Presence alone does
 * not mean the service is loaded — see `readLaunchdPlist`.
 */
export function launchdPlistExists(label: string, home: string): boolean {
  return launchAgentDirs(home).some((dir) => existsSync(path.join(dir, `${label}.plist`)));
}

/** Read and parse the installed plist for the label, or null when absent/unparsable. */
export function readLaunchdPlist(
  label: string,
  home: string,
): { path: string; program: string[]; env: Record<string, string> } | null {
  for (const dir of launchAgentDirs(home)) {
    const plistPath = path.join(dir, `${label}.plist`);
    if (!existsSync(plistPath)) continue;
    try {
      const doc = parsePlistJson(plistPath) as Record<string, unknown>;
      const program = (doc.ProgramArguments as string[] | undefined) ?? [];
      const envDict = (doc.EnvironmentVariables as Record<string, string> | undefined) ?? {};
      return { path: plistPath, program, env: envDict };
    } catch {
      return null;
    }
  }
  return null;
}

/** Parse a plist via the macOS-native `plutil -convert json` (no npm dependency). */
function parsePlistJson(plistPath: string): unknown {
  const result = spawnSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) throw new Error(`plutil failed: ${result.stderr ?? ""}`);
  return JSON.parse(result.stdout);
}

/**
 * Collect the env vars the daemon needs to survive in a bare launchd environment:
 * BYSPACE_* overrides plus a PATH that can resolve agent binaries (pi/claude/...) and
 * git. Snapshot from the *installing* shell — that is the environment that worked.
 */
export function snapshotServiceEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("BYSPACE_") && value !== undefined) snapshot[key] = value;
  }
  snapshot.PATH = env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return snapshot;
}

/** Build the ServiceSpec for the current process. Throws when prerequisites are missing. */
export function buildDaemonServiceSpec(options: {
  home: string;
  logPath: string;
  runnerEntry: string;
  runnerArgs?: string[];
  env?: NodeJS.ProcessEnv;
}): DaemonServiceSpec {
  const env = options.env ?? process.env;
  const nodePath = process.execPath;
  if (!nodePath.startsWith("/")) {
    throw new Error(`node executable is not an absolute path: ${nodePath}`);
  }
  if (!options.runnerEntry || !path.isAbsolute(options.runnerEntry)) {
    throw new Error(
      `daemon runner entry must be an absolute path, got: ${options.runnerEntry || "(empty)"}`,
    );
  }
  if (!existsSync(options.runnerEntry)) {
    throw new Error(`daemon runner entry does not exist: ${options.runnerEntry}`);
  }
  return {
    label: "cc.cd.byspace.daemon",
    nodePath,
    runnerEntry: options.runnerEntry,
    runnerArgs: options.runnerArgs ?? [],
    logPath: options.logPath,
    env: snapshotServiceEnv(env),
  };
}
