import { describe, expect, it } from "vitest";
import { describeBranchSuggestion, resolveBranchSuggestionScope } from "./use-branch-switcher";

describe("describeBranchSuggestion", () => {
  const labels = { local: "Local", remote: "Remote" };

  it("describes branches that exist both locally and remotely", () => {
    expect(
      describeBranchSuggestion({ name: "main", hasLocal: true, hasRemote: true }, labels),
    ).toBe("Local • Remote");
  });

  it("describes remote-only branches", () => {
    expect(
      describeBranchSuggestion({ name: "topic", hasLocal: false, hasRemote: true }, labels),
    ).toBe("Remote");
  });

  it("omits the description when locality is unknown", () => {
    expect(describeBranchSuggestion({ name: "topic" }, labels)).toBeUndefined();
  });
});

describe("resolveBranchSuggestionScope", () => {
  it("marks local-only branches", () => {
    expect(resolveBranchSuggestionScope({ name: "topic", hasLocal: true, hasRemote: false })).toBe(
      "local",
    );
  });

  it("marks remote-only branches", () => {
    expect(resolveBranchSuggestionScope({ name: "topic", hasLocal: false, hasRemote: true })).toBe(
      "remote",
    );
  });

  it("marks branches that exist locally and remotely", () => {
    expect(resolveBranchSuggestionScope({ name: "main", hasLocal: true, hasRemote: true })).toBe(
      "local-and-remote",
    );
  });
});
