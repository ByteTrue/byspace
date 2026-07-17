import { describe, expect, it } from "vitest";
import { resolveComposerAttachmentSubmitFormat } from "./submit";

describe("resolveComposerAttachmentSubmitFormat", () => {
  it("keeps GitHub attachments compatible with an old host", () => {
    expect(
      resolveComposerAttachmentSubmitFormat({
        supportsForgeAttachments: false,
        attachments: [
          {
            kind: "github_pr",
            item: {
              kind: "change_request",
              forge: "github",
              number: 1,
              title: "PR",
              url: "https://github.com/ByteTrue/byspace/pull/1",
              state: "OPEN",
              body: null,
              labels: [],
            },
          },
        ],
      }),
    ).toBe("legacy-github");
  });

  it("refuses to serialize a non-GitHub attachment through the legacy GitHub shape", () => {
    expect(() =>
      resolveComposerAttachmentSubmitFormat({
        supportsForgeAttachments: false,
        attachments: [
          {
            kind: "forge_change_request",
            item: {
              kind: "change_request",
              forge: "gitlab",
              number: 2,
              title: "MR",
              url: "https://gitlab.com/acme/repo/-/merge_requests/2",
              state: "opened",
              body: null,
              labels: [],
            },
          },
        ],
      }),
    ).toThrow("Update the host");
  });
});
