import type { TerminalProfile } from "./messages.js";
import { KNOWN_PROVIDER_ICON_NAMES } from "./provider-icon-names.js";

/** Marks where a typed prompt goes inside a profile's command or args. */
export const PROMPT_SENTINEL = "{{{prompt}}}";

export const DEFAULT_TERMINAL_PROFILES: readonly TerminalProfile[] = [
  { id: "claude", name: "Claude Code", command: "claude", args: [PROMPT_SENTINEL], icon: "claude" },
  { id: "codex", name: "Codex", command: "codex", args: [PROMPT_SENTINEL], icon: "codex" },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: [`--prompt=${PROMPT_SENTINEL}`],
    icon: "opencode",
  },
  { id: "pi", name: "Pi", command: "pi", args: [PROMPT_SENTINEL], icon: "pi" },
];

export interface SubstitutableCommand {
  command: string;
  args?: string[];
}

export interface ResolvedCommand {
  command: string;
  args: string[];
}

function containsSentinel(value: string): boolean {
  return value.includes(PROMPT_SENTINEL);
}

export function profileTakesPrompt(profile: SubstitutableCommand): boolean {
  return containsSentinel(profile.command) || (profile.args ?? []).some(containsSentinel);
}

function replaceSentinel(value: string, prompt: string): string {
  return value.split(PROMPT_SENTINEL).join(prompt);
}

function isPromptOnlyArg(arg: string): boolean {
  if (arg === PROMPT_SENTINEL) {
    return true;
  }
  const separator = arg.indexOf("=");
  return separator > 0 && arg.slice(separator + 1) === PROMPT_SENTINEL;
}

export function substitutePrompt(profile: SubstitutableCommand, prompt: string): ResolvedCommand {
  return {
    command: replaceSentinel(profile.command, prompt),
    args: (profile.args ?? []).flatMap((arg) =>
      prompt === "" && isPromptOnlyArg(arg) ? [] : [replaceSentinel(arg, prompt)],
    ),
  };
}

export function formatResolvedCommand(resolved: ResolvedCommand): string {
  return [resolved.command, ...resolved.args].join(" ");
}

export interface TerminalProfileLaunch {
  name: string;
  command: string;
  args: string[];
}

export function resolveTerminalProfileLaunch(
  profile: TerminalProfile,
  prompt: string,
): TerminalProfileLaunch {
  return { name: profile.name, ...substitutePrompt(profile, prompt) };
}

const WELL_KNOWN_COMMAND_ICONS = new Map(KNOWN_PROVIDER_ICON_NAMES.map((name) => [name, name]));

function getCommandBaseName(command: string): string {
  const lastSlash = command.lastIndexOf("/");
  const lastBackslash = command.lastIndexOf("\\");
  const start = Math.max(lastSlash, lastBackslash) + 1;
  const base = command.slice(start).toLowerCase();
  const dotIndex = base.indexOf(".");
  return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}

export function guessTerminalProfileIcon(command: string): string | undefined {
  return WELL_KNOWN_COMMAND_ICONS.get(getCommandBaseName(command));
}

export function getTerminalProfileIcon(profile: TerminalProfile): string | undefined {
  return profile.icon ?? guessTerminalProfileIcon(profile.command);
}

const PROMPT_ARGS_BY_COMMAND = new Map(
  DEFAULT_TERMINAL_PROFILES.map((profile) => [
    getCommandBaseName(profile.command),
    (profile.args ?? []).filter(containsSentinel),
  ]),
);

const GLOBAL_OPTIONS_WITH_VALUES_BY_COMMAND = new Map<string, ReadonlySet<string>>([
  [
    "claude",
    new Set([
      "--add-dir",
      "--agent",
      "--agents",
      "--allowed-tools",
      "--allowedTools",
      "--append-system-prompt",
      "--betas",
      "--debug-file",
      "--disallowed-tools",
      "--disallowedTools",
      "--effort",
      "--fallback-model",
      "--file",
      "--input-format",
      "--json-schema",
      "--max-budget-usd",
      "--mcp-config",
      "--model",
      "--name",
      "--output-format",
      "--permission-mode",
      "--plugin-dir",
      "--plugin-url",
      "--remote-control-session-name-prefix",
      "--settings",
      "--system-prompt",
      "--system-prompt-file",
      "--tools",
      "-n",
    ]),
  ],
  [
    "codex",
    new Set([
      "--add-dir",
      "--ask-for-approval",
      "--cd",
      "--config",
      "--disable",
      "--enable",
      "--image",
      "--local-provider",
      "--model",
      "--profile",
      "--remote",
      "--remote-auth-token-env",
      "--sandbox",
      "-C",
      "-a",
      "-c",
      "-i",
      "-m",
      "-p",
      "-s",
    ]),
  ],
  [
    "opencode",
    new Set([
      "--agent",
      "--cors",
      "--hostname",
      "--log-level",
      "--mdns-domain",
      "--model",
      "--port",
      "--prompt",
      "--replay-limit",
      "--session",
      "-m",
      "-s",
    ]),
  ],
  [
    "pi",
    new Set([
      "--api-key",
      "--append-system-prompt",
      "--exclude-tools",
      "--export",
      "--extension",
      "--fork",
      "--mode",
      "--model",
      "--models",
      "--name",
      "--prompt-template",
      "--provider",
      "--session",
      "--session-dir",
      "--session-id",
      "--skill",
      "--system-prompt",
      "--theme",
      "--thinking",
      "--tools",
      "-e",
      "-n",
      "-t",
      "-xt",
    ]),
  ],
]);

function hasPositionalArg(command: string, args: readonly string[]): boolean {
  const optionsWithValues = GLOBAL_OPTIONS_WITH_VALUES_BY_COMMAND.get(command) ?? new Set();
  let expectsOptionValue = false;

  for (const arg of args) {
    if (expectsOptionValue) {
      expectsOptionValue = false;
      continue;
    }
    if (arg === "--") {
      return true;
    }
    if (!arg.startsWith("-")) {
      return true;
    }

    const separator = arg.indexOf("=");
    const option = separator === -1 ? arg : arg.slice(0, separator);
    expectsOptionValue = separator === -1 && optionsWithValues.has(option);
  }

  return false;
}

function adoptPromptSentinel(profile: TerminalProfile): TerminalProfile {
  const command = getCommandBaseName(profile.command);
  const promptArgs = PROMPT_ARGS_BY_COMMAND.get(command);
  if (!promptArgs || promptArgs.length === 0) {
    return profile;
  }
  const args = profile.args ?? [];
  if (profileTakesPrompt(profile) || hasPositionalArg(command, args)) {
    return profile;
  }
  return { ...profile, args: [...args, ...promptArgs] };
}

export function resolveTerminalProfiles(
  terminalProfiles: TerminalProfile[] | undefined,
): readonly TerminalProfile[] {
  if (terminalProfiles === undefined) {
    return DEFAULT_TERMINAL_PROFILES;
  }
  return terminalProfiles.map(adoptPromptSentinel);
}
