import { resolveTerminalProfileLaunch } from "@bytetrue/byspace-protocol/terminal-profiles";
import type { TerminalProfile } from "@bytetrue/byspace-protocol/messages";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import type { PinnedTabTarget } from "@/workspace-pins/target";

export interface TabTargetHandlers {
  createDraft: () => void;
  createTerminal: () => void;
  openChanges: () => void;
  openFiles: () => void;
  openPullRequest: () => void;

  createTerminalWithProfile: (profile: TerminalProfileInput) => void;
}

export function runPinnedTabTarget(
  target: PinnedTabTarget,
  profiles: readonly TerminalProfile[],
  handlers: TabTargetHandlers,
): void {
  if (target.kind === "draft") {
    handlers.createDraft();
    return;
  }
  if (target.kind === "terminal") {
    handlers.createTerminal();
    return;
  }
  if (target.kind === "working_diff") {
    handlers.openChanges();
    return;
  }
  if (target.kind === "files") {
    handlers.openFiles();
    return;
  }
  if (target.kind === "pull_request") {
    handlers.openPullRequest();
    return;
  }

  const profile = profiles.find((entry) => entry.id === target.profileId);
  if (!profile) {
    return;
  }
  handlers.createTerminalWithProfile(resolveTerminalProfileLaunch(profile, ""));
}
