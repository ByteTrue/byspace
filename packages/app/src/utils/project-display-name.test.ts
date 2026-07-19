import { describe, expect, it } from "vitest";
import {
  projectDisplayNameFromProjectId,
  projectIconPlaceholderLabelFromDisplayName,
} from "./project-display-name";

describe("projectDisplayNameFromProjectId", () => {
  it("shows owner and repo for GitHub remote ids", () => {
    expect(projectDisplayNameFromProjectId("remote:github.com/ByteTrue/byspace")).toBe(
      "ByteTrue/byspace",
    );
  });

  it("shows the trailing directory name for local projects", () => {
    expect(projectDisplayNameFromProjectId("/Users/me/dev/byspace")).toBe("byspace");
  });
});

describe("projectIconPlaceholderLabelFromDisplayName", () => {
  it("uses repo name instead of owner for GitHub-style display names", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("ByteTrue/byspace")).toBe("byspace");
  });

  it("returns the original display name when it has no path separator", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("byspace")).toBe("byspace");
  });
});
