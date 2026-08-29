import { describe, expect, it } from "vitest";
import { deriveProjectKey } from "./project-key.js";

describe("deriveProjectKey", () => {
  it("groups the same remote across hosts and normalizes default ports", () => {
    const first = deriveProjectKey({
      serverId: "host-a",
      rootPath: "/srv/a/repo",
      remoteUrl: "HTTPS://Example.COM:443/Owner/Repo.git",
      worktreeRoot: "/srv/a/repo",
      mainRepoRoot: null,
    });
    const second = deriveProjectKey({
      serverId: "host-b",
      rootPath: "D:\\repo",
      remoteUrl: "https://example.com/Owner/Repo",
      worktreeRoot: "D:\\repo",
      mainRepoRoot: null,
    });
    expect(first).toBe("remote:https://example.com/Owner/Repo");
    expect(second).toBe(first);
  });

  it("keeps non-default ports and selected subdirectories", () => {
    expect(
      deriveProjectKey({
        serverId: "host-a",
        rootPath: "/srv/repo/packages/app",
        remoteUrl: "ssh://git@example.com:2222/Owner/Repo.git",
        worktreeRoot: "/srv/repo",
        mainRepoRoot: null,
      }),
    ).toBe("remote:ssh://example.com:2222/Owner/Repo#subdir:packages/app");
  });

  it("host-frames local Windows/UNC identities", () => {
    const first = deriveProjectKey({
      serverId: "host-a",
      rootPath: "\\\\server\\share\\repo",
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });
    const second = deriveProjectKey({
      serverId: "host-b",
      rootPath: "\\\\server\\share\\repo",
      remoteUrl: null,
      worktreeRoot: null,
      mainRepoRoot: null,
    });
    expect(first).toMatch(/^host:host-a:/u);
    expect(second).toMatch(/^host:host-b:/u);
    expect(first).not.toBe(second);
  });

  it("normalizes scp-like GitHub remotes", () => {
    expect(
      deriveProjectKey({
        serverId: "host-a",
        rootPath: "/repo",
        remoteUrl: "git@GitHub.com:Owner/Repo.git",
        worktreeRoot: "/repo",
        mainRepoRoot: null,
      }),
    ).toBe("remote:ssh://github.com/owner/repo");
  });
});
