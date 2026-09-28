import type { TerminalProfile } from "@bytetrue/protocol/messages";
import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_PROFILES } from "@bytetrue/protocol/terminal-profiles";
import {
  applyProviderProfileDraft,
  draftFromProfile,
  parseProfileArgs,
} from "./provider-terminal-profile-save";

const profiles = DEFAULT_TERMINAL_PROFILES as unknown as TerminalProfile[];

describe("applyProviderProfileDraft", () => {
  it("replaces the matching profile in place so the user's order survives", () => {
    const reordered = [profiles.find((p) => p.id === "pi")!, ...profiles.slice(0, 3)];
    const next = applyProviderProfileDraft(reordered, "codex", {
      name: "Codex",
      command: "codex",
      args: "--yolo",
    });

    expect(next.map((p) => p.id)).toEqual(["pi", "claude", "codex", "opencode"]);
    expect(next[2]).toEqual({
      id: "codex",
      name: "Codex",
      command: "codex",
      args: ["--yolo"],
      icon: "codex",
    });
  });

  // A profile created in the settings UI has a generated id, so the match is by
  // command; the rewrite must land on that row rather than append a duplicate.
  it("finds a repointed custom profile by command and keeps its id and icon", () => {
    const custom: TerminalProfile[] = [
      { id: "profile_ab_1", name: "My claude", command: "/usr/local/bin/claude", icon: "claude" },
    ];
    const next = applyProviderProfileDraft(custom, "claude", {
      name: "My claude",
      command: "/usr/local/bin/claude",
      args: "",
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      id: "profile_ab_1",
      name: "My claude",
      command: "/usr/local/bin/claude",
      icon: "claude",
    });
  });

  it("appends when the provider has no profile, leaving other rows untouched", () => {
    const next = applyProviderProfileDraft([], "pi", {
      name: "Pi",
      command: "pi",
      args: "--thinking high",
    });

    expect(next).toEqual([
      { id: "pi-terminal", name: "Pi", command: "pi", args: ["--thinking", "high"] },
    ]);
  });

  it("drops an empty args field instead of persisting an empty array", () => {
    const next = applyProviderProfileDraft(profiles, "opencode", {
      name: "OpenCode",
      command: "opencode",
      args: "   ",
    });
    expect(next.find((p) => p.id === "opencode")).toEqual({
      id: "opencode",
      name: "OpenCode",
      command: "opencode",
      icon: "opencode",
    });
  });

  it("round-trips a stored profile through the draft and back", () => {
    const profile = profiles.find((p) => p.id === "opencode")!;
    const draft = draftFromProfile(profile);
    expect(draft.args).toBe("--prompt={{{prompt}}}");
    expect(parseProfileArgs(draft.args)).toEqual(["--prompt={{{prompt}}}"]);
    expect(applyProviderProfileDraft(profiles, "opencode", draft)).toEqual(profiles);
  });
});
