import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated workflow", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-ByteTrue",
              accountLogin: "ByteTrue",
              accountType: "Organization",
              repositories: ["ByteTrue/byspace"],
            },
          ],
          slack: [{ teamId: "T123", teamName: "BySpace" }],
          discord: [{ guildId: "456", guildName: "BySpace Discord" }],
        },
        "ByteTrue/byspace",
      ),
    ).toEqual([
      {
        id: "github:ByteTrue/byspace",
        label: "GitHub — ByteTrue/byspace",
        provider: "github",
        filters: { repo: "ByteTrue/byspace" },
      },
      {
        id: "slack:T123",
        label: "Slack — BySpace",
        provider: "slack",
        filters: { workspace: "T123" },
      },
      {
        id: "discord:456",
        label: "Discord — BySpace Discord",
        provider: "discord",
        filters: { guild: "456" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-ByteTrue",
              accountLogin: "ByteTrue",
              accountType: "Organization",
              repositories: ["ByteTrue/hub"],
            },
          ],
          slack: [],
          discord: [],
        },
        "ByteTrue/byspace",
      ),
    ).toEqual([]);
  });
});
