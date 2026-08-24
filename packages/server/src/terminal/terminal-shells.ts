import { isCommandAvailableSync } from "../executable-resolution/executable-resolution.js";

export const TERMINAL_SHELL_COMMANDS = [
  "pwsh.exe",
  "powershell.exe",
  "cmd.exe",
  "pwsh",
  "bash",
  "zsh",
] as const;

export type AvailableTerminalShell = (typeof TERMINAL_SHELL_COMMANDS)[number];

const WINDOWS_TERMINAL_SHELL_COMMANDS: readonly AvailableTerminalShell[] = [
  "pwsh.exe",
  "powershell.exe",
  "cmd.exe",
  "bash",
  "zsh",
];

const POSIX_TERMINAL_SHELL_COMMANDS: readonly AvailableTerminalShell[] = ["pwsh", "bash", "zsh"];

export function getAvailableTerminalShells(
  platform: NodeJS.Platform = process.platform,
  isAvailable: (command: string) => boolean = isCommandAvailableSync,
): AvailableTerminalShell[] {
  const candidates =
    platform === "win32" ? WINDOWS_TERMINAL_SHELL_COMMANDS : POSIX_TERMINAL_SHELL_COMMANDS;
  return candidates.filter(isAvailable);
}
