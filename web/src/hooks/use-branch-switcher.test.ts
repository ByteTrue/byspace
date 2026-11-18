import { describe, expect, it } from "vitest";
import { describeBranchSuggestion, resolveBranchSuggestionScope } from "./use-branch-switcher";

describe("resolveBranchSuggestionScope", () => {
  it.each([
    [{ name: "local", hasLocal: true, hasRemote: false }, "local"],
    [{ name: "remote", hasLocal: false, hasRemote: true }, "remote"],
    [{ name: "shared", hasLocal: true, hasRemote: true }, "local-and-remote"],
  ] as const)("classifies %s", (branch, expected) => {
    expect(resolveBranchSuggestionScope(branch)).toBe(expected);
  });

  it.each([{ name: "legacy" }, { name: "unknown", hasLocal: false, hasRemote: false }])(
    "leaves unknown locality unclassified for %s",
    (branch) => {
      expect(resolveBranchSuggestionScope(branch)).toBeUndefined();
    },
  );
});

describe("describeBranchSuggestion", () => {
  const labels = { local: "Local", remote: "Remote" };

  it.each([
    [{ name: "local", hasLocal: true, hasRemote: false }, "Local"],
    [{ name: "remote", hasLocal: false, hasRemote: true }, "Remote"],
    [{ name: "shared", hasLocal: true, hasRemote: true }, "Local • Remote"],
  ] as const)("describes %s", (branch, expected) => {
    expect(describeBranchSuggestion(branch, labels)).toBe(expected);
  });

  it("omits the description when locality is unknown", () => {
    expect(describeBranchSuggestion({ name: "legacy" }, labels)).toBeUndefined();
  });
});
