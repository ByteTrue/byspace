import { describe, expect, it } from "vitest";
import type { TerminalProfile } from "@bytetrue/byspace-protocol/messages";
import {
  filterTerminalProfiles,
  getTerminalProfileProviderId,
  moveTerminalProfile,
} from "./terminal-profile-groups";

const profiles: TerminalProfile[] = [
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "shell", name: "Shell", command: "bash" },
  { id: "claude-review", name: "Claude review", command: "/usr/local/bin/claude" },
  { id: "custom", name: "Custom", command: "runner", icon: "custom" },
  { id: "claude-custom-icon", name: "Claude custom", command: "claude", icon: "custom" },
];

describe("terminal profile groups", () => {
  it("groups known provider commands and leaves arbitrary commands in Other", () => {
    expect(getTerminalProfileProviderId(profiles[0])).toBe("claude");
    expect(getTerminalProfileProviderId(profiles[1])).toBeNull();
    expect(filterTerminalProfiles(profiles, "claude").map((profile) => profile.id)).toEqual([
      "claude",
      "claude-review",
      "claude-custom-icon",
    ]);
    expect(filterTerminalProfiles(profiles, null).map((profile) => profile.id)).toEqual([
      "shell",
      "custom",
    ]);
  });

  it("reorders profiles inside a group without disturbing profiles between them", () => {
    const claudeProfiles = filterTerminalProfiles(profiles, "claude");
    const next = moveTerminalProfile(profiles, claudeProfiles, "claude-review", -1);

    expect(next?.map((profile) => profile.id)).toEqual([
      "claude-review",
      "shell",
      "claude",
      "custom",
      "claude-custom-icon",
    ]);
  });
});
