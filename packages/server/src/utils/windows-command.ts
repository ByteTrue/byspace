import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

export function isWindowsCommandScript(executablePath: string): boolean {
  const extension = extname(executablePath).toLowerCase();
  return process.platform === "win32" && (extension === ".cmd" || extension === ".bat");
}

const DEFAULT_PATH_EXT = ".com;.exe;.bat;.cmd";

const NATIVE_EXECUTABLE_SUFFIXES = new Set([".exe", ".com"]);

export function parsePathExtSuffixes(pathExtValue: string | undefined): string[] {
  const suffixes = (pathExtValue ?? "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith("."));
  return suffixes.length > 0 ? [...new Set(suffixes)] : DEFAULT_PATH_EXT.split(";");
}

/**
 * Resolve a bare command name against PATH in PATHEXT order. Only suffixed
 * targets are matched; a name that resolves to nothing returns null so the
 * caller keeps running it through the shell.
 */
export function resolveWindowsExecutable(
  command: string,
  options: {
    pathValue: string | undefined;
    suffixes: string[];
    fileExists?: (path: string) => boolean;
  },
): string | null {
  const fileExists = options.fileExists ?? existsSync;
  for (const directory of (options.pathValue ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const suffix of options.suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Only a native binary can be spawned without a shell. Batch launchers and
 * whatever else PATHEXT is configured to run - `.ps1`, for instance - still need
 * `cmd.exe` to invoke them.
 *
 * Passing a native binary through `cmd.exe` truncates its arguments: cmd.exe
 * ends its command line at the first newline and only concatenates arguments,
 * so a multi-line GraphQL query never reaches the child.
 */
export function windowsCommandNeedsShell(
  command: string,
  env: Record<string, string | undefined>,
): boolean {
  const resolved = resolveWindowsExecutable(command, {
    pathValue: env.PATH ?? env.Path,
    suffixes: parsePathExtSuffixes(env.PATHEXT),
  });
  if (resolved === null) return true;
  return !NATIVE_EXECUTABLE_SUFFIXES.has(extname(resolved).toLowerCase());
}

function escapeWindowsCmdValue(value: string): string {
  if (process.platform !== "win32") return value;

  const isQuoted = value.startsWith('"') && value.endsWith('"');
  const unquoted = isQuoted ? value.slice(1, -1) : value;
  // Do NOT double `%` here. cmd.exe only collapses `%%` → `%` inside batch
  // files; on the command line / `cmd /c "..."` `%%` stays literal, which
  // breaks args like git's `--format=%(refname)` (git treats `%%` as the
  // escape for a literal `%`, so the format atoms become literals).
  const escaped = unquoted.replace(/([&|^<>()!])/g, "^$1");

  if (isQuoted || /[\s"]/u.test(unquoted)) {
    const quoted = escaped
      .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\"`)
      .replace(/\\+$/u, (slashes) => `${slashes}${slashes}`);
    return `"${quoted}"`;
  }

  return escaped;
}

/**
 * When spawning with `shell: true` on Windows, the command is passed to
 * `cmd.exe /d /s /c "command args"`. The `/s` strips outer quotes, so a
 * command path with spaces (e.g. `C:\Program Files\...`) is split at the
 * space. Wrapping it in quotes produces the correct `"C:\Program Files\..." args`.
 */
export function quoteWindowsCommand(command: string): string {
  return escapeWindowsCmdValue(command);
}

/**
 * `spawn(..., { shell: true })` on Windows also passes argv through `cmd.exe`.
 * Any argument containing spaces must be quoted or it will be split before the
 * child process sees it.
 */
export function quoteWindowsArgument(argument: string): string {
  return escapeWindowsCmdValue(argument);
}
