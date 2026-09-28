import type { TerminalProfile } from "@bytetrue/protocol/messages";
import { findTerminalProfileForProvider } from "@bytetrue/protocol/terminal-profiles";
import type { ProfileDraft } from "@/screens/settings/terminal-profile-edit-modal";

/**
 * The whole-list rewrite behind a provider sheet's launch-command edit.
 *
 * `terminalProfiles` has exactly one owner — the Overview list — and every save
 * replaces the array. So this returns the *next array*, never a fragment: an
 * edit replaces in place to keep the user's order, and an add appends so a new
 * agent launcher lands at the bottom of the terminal menu rather than above the
 * profiles someone already ranked.
 */

export function parseProfileArgs(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

export function draftFromProfile(profile: TerminalProfile): ProfileDraft {
  return {
    name: profile.name,
    command: profile.command,
    args: profile.args ? profile.args.join(" ") : "",
  };
}

export function applyProviderProfileDraft(
  profiles: readonly TerminalProfile[],
  provider: string,
  draft: ProfileDraft,
): TerminalProfile[] {
  const existing = findTerminalProfileForProvider(profiles, provider);
  const args = parseProfileArgs(draft.args);
  const next: TerminalProfile = {
    // An existing profile keeps its stored id; a new one gets a stable,
    // readable id instead of the generated `profile_<ts>_<rand>` the settings
    // UI uses, so a later edit finds it by provider as well.
    id: existing?.id ?? `${provider}-terminal`,
    name: draft.name,
    command: draft.command,
    ...(args.length > 0 ? { args } : {}),
    ...(existing?.icon ? { icon: existing.icon } : {}),
  };
  return existing
    ? profiles.map((profile) => (profile.id === existing.id ? next : profile))
    : [...profiles, next];
}
