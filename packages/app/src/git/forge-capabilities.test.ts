import { describe, expect, it } from "vitest";
import { resolveForgeCapabilities } from "./forge-capabilities";

describe("resolveForgeCapabilities", () => {
  it("keeps released GitHub operations on legacy RPCs for an old host", () => {
    expect(
      resolveForgeCapabilities({
        forge: "github",
        features: { githubCheckDetails: true, checkoutGithubSetAutoMerge: true },
      }),
    ).toEqual({
      canPresent: true,
      search: "legacy-github",
      attachments: "legacy-github",
      checkDetails: "legacy-github",
      autoMerge: "legacy-github",
    });
  });

  it("does not route a non-GitHub forge through legacy GitHub RPCs", () => {
    expect(
      resolveForgeCapabilities({
        forge: "gitlab",
        features: { githubCheckDetails: true, checkoutGithubSetAutoMerge: true },
      }),
    ).toEqual({
      canPresent: false,
      search: "unavailable",
      attachments: "unavailable",
      checkDetails: "unavailable",
      autoMerge: "unavailable",
    });
  });

  it("uses each operation-specific forge gate independently", () => {
    expect(
      resolveForgeCapabilities({
        forge: "gitlab",
        features: {
          forgeProviders: true,
          forgeSearch: true,
          forgeCheckDetails: false,
          checkoutForgeSetAutoMerge: true,
        },
      }),
    ).toEqual({
      canPresent: true,
      search: "forge",
      attachments: "forge",
      checkDetails: "unavailable",
      autoMerge: "forge",
    });
  });
});
