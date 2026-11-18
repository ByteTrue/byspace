import { describe, expect, it } from "vitest";
import { buildProjectRowCues, buildProjectRowPathLines } from "./project-row-cue";

const labels = new Map([
  ["mac", "mac-mini"],
  ["wsl", "wsl-ubuntu"],
  ["other", "third-box"],
]);

function project(overrides: {
  viewKey: string;
  projectName: string;
  hosts: Array<{ serverId: string; iconWorkingDir: string }>;
}) {
  return overrides;
}

describe("buildProjectRowCues", () => {
  it("says nothing when no two projects share a name", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "chat",
          hosts: [{ serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" }],
        }),
        project({
          viewKey: "b",
          projectName: "notes",
          hosts: [{ serverId: "wsl", iconWorkingDir: "/home/me/notes" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.size).toBe(0);
  });

  it("names the host and the path for every row in a collision", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "chat",
          hosts: [{ serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" }],
        }),
        project({
          viewKey: "b",
          projectName: "chat",
          hosts: [{ serverId: "wsl", iconWorkingDir: "/home/me/chat" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.get("a")).toBe("mac-mini · ~/dev/chat");
    expect(cues.get("b")).toBe("wsl-ubuntu · ~/chat");
  });

  it("keeps the two halves apart when the shortened paths would agree", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "chat",
          hosts: [{ serverId: "mac", iconWorkingDir: "/Users/me/chat" }],
        }),
        project({
          viewKey: "b",
          projectName: "chat",
          hosts: [{ serverId: "wsl", iconWorkingDir: "/home/me/chat" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.get("a")).not.toBe(cues.get("b"));
  });

  it("matches names case-insensitively and ignores surrounding space", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "Chat",
          hosts: [{ serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" }],
        }),
        project({
          viewKey: "b",
          projectName: " chat ",
          hosts: [{ serverId: "wsl", iconWorkingDir: "/home/me/chat" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.size).toBe(2);
  });

  it("falls back to the serverId when a host has no label", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "chat",
          hosts: [{ serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" }],
        }),
        project({
          viewKey: "b",
          projectName: "chat",
          hosts: [{ serverId: "unknown", iconWorkingDir: "/home/me/chat" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.get("b")).toBe("unknown · ~/chat");
  });

  it("lists every host of a project that spans machines, naming only the first two", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "acme/chat",
          hosts: [
            { serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" },
            { serverId: "wsl", iconWorkingDir: "/home/me/chat" },
            { serverId: "other", iconWorkingDir: "/srv/chat" },
          ],
        }),
        project({
          viewKey: "b",
          projectName: "acme/chat",
          hosts: [{ serverId: "other", iconWorkingDir: "/opt/chat" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.get("a")).toBe("mac-mini, wsl-ubuntu… · ~/dev/chat");
  });

  it("keeps a host-only cue when no host has a path", () => {
    const cues = buildProjectRowCues({
      projects: [
        project({
          viewKey: "a",
          projectName: "chat",
          hosts: [{ serverId: "mac", iconWorkingDir: "" }],
        }),
        project({
          viewKey: "b",
          projectName: "chat",
          hosts: [{ serverId: "wsl", iconWorkingDir: "" }],
        }),
      ],
      hostLabelByServerId: labels,
    });

    expect(cues.get("a")).toBe("mac-mini");
  });
});

describe("buildProjectRowPathLines", () => {
  it("shows the bare path for a project on one host", () => {
    const lines = buildProjectRowPathLines({
      project: project({
        viewKey: "a",
        projectName: "chat",
        hosts: [{ serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" }],
      }),
      hostLabelByServerId: labels,
    });

    expect(lines).toEqual([{ serverId: "mac", text: "/Users/me/dev/chat" }]);
  });

  it("labels each line when the project spans hosts", () => {
    const lines = buildProjectRowPathLines({
      project: project({
        viewKey: "a",
        projectName: "chat",
        hosts: [
          { serverId: "mac", iconWorkingDir: "/Users/me/dev/chat" },
          { serverId: "wsl", iconWorkingDir: "/home/me/chat" },
        ],
      }),
      hostLabelByServerId: labels,
    });

    expect(lines).toEqual([
      { serverId: "mac", text: "mac-mini · /Users/me/dev/chat" },
      { serverId: "wsl", text: "wsl-ubuntu · /home/me/chat" },
    ]);
  });

  it("gives each line a distinct key even when two hosts render the same text", () => {
    const lines = buildProjectRowPathLines({
      project: project({
        viewKey: "a",
        projectName: "chat",
        hosts: [
          { serverId: "mac", iconWorkingDir: "/srv/chat" },
          { serverId: "wsl", iconWorkingDir: "/srv/chat" },
        ],
      }),
      // Both hosts are labelled the same, so label + path are identical strings.
      hostLabelByServerId: new Map([
        ["mac", "devbox"],
        ["wsl", "devbox"],
      ]),
    });

    expect(lines.map((line) => line.text)).toEqual(["devbox · /srv/chat", "devbox · /srv/chat"]);
    expect(new Set(lines.map((line) => line.serverId)).size).toBe(2);
  });

  it("falls back to the serverIds when no host has a path", () => {
    const lines = buildProjectRowPathLines({
      project: project({
        viewKey: "a",
        projectName: "chat",
        hosts: [{ serverId: "mac", iconWorkingDir: "" }],
      }),
      hostLabelByServerId: labels,
    });

    expect(lines).toEqual([{ serverId: "mac", text: "mac" }]);
  });

  it("returns nothing when the project has no hosts at all", () => {
    const lines = buildProjectRowPathLines({
      project: project({ viewKey: "a", projectName: "chat", hosts: [] }),
      hostLabelByServerId: labels,
    });

    expect(lines).toEqual([]);
  });
});
