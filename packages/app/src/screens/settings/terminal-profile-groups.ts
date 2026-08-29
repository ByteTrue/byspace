import type { TerminalProfile } from "@bytetrue/byspace-protocol/messages";
import { guessTerminalProfileIcon } from "@bytetrue/byspace-protocol/terminal-profiles";

export const TERMINAL_PROVIDER_IDS = ["claude", "codex", "opencode", "pi"] as const;

export type TerminalProviderId = (typeof TERMINAL_PROVIDER_IDS)[number];

export function isTerminalProviderId(providerId: string): providerId is TerminalProviderId {
  return TERMINAL_PROVIDER_IDS.some((candidate) => candidate === providerId);
}

export function getTerminalProfileProviderId(profile: TerminalProfile): TerminalProviderId | null {
  if (profile.icon && isTerminalProviderId(profile.icon)) return profile.icon;

  const commandIcon = guessTerminalProfileIcon(profile.command);
  return commandIcon && isTerminalProviderId(commandIcon) ? commandIcon : null;
}

export function filterTerminalProfiles(
  profiles: readonly TerminalProfile[],
  providerId: TerminalProviderId | null,
): TerminalProfile[] {
  return profiles.filter((profile) => getTerminalProfileProviderId(profile) === providerId);
}

export function moveTerminalProfile(
  profiles: readonly TerminalProfile[],
  visibleProfiles: readonly TerminalProfile[],
  profileId: string,
  offset: -1 | 1,
): TerminalProfile[] | null {
  const visibleIndex = visibleProfiles.findIndex((profile) => profile.id === profileId);
  const target = visibleProfiles[visibleIndex + offset];
  if (visibleIndex < 0 || !target) return null;

  const next = [...profiles];
  const sourceIndex = next.findIndex((profile) => profile.id === profileId);
  const targetIndex = next.findIndex((profile) => profile.id === target.id);
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}
