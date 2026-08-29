import { describe, expect, it } from "vitest";
import { isCompleteGitRemote, parseGitRemoteLocation } from "./git-remote.js";

describe("isCompleteGitRemote", () => {
  it("treats supported URLs and scp-like addresses as complete remotes", () => {
    expect(isCompleteGitRemote("https://github.com/owner/repo")).toBe(true);
    expect(isCompleteGitRemote("http://internal/owner/repo.git")).toBe(true);
    expect(isCompleteGitRemote("ssh://git@github.com/owner/repo")).toBe(true);
    expect(isCompleteGitRemote("git@github.com:owner/repo.git")).toBe(true);
    expect(isCompleteGitRemote("  https://github.com/owner/repo  ")).toBe(true);
  });

  it("treats owner/repo shorthand as incomplete (needs a clone protocol)", () => {
    expect(isCompleteGitRemote("owner/repo")).toBe(false);
    expect(isCompleteGitRemote("owner/repo.git")).toBe(false);
    expect(isCompleteGitRemote("")).toBe(false);
  });

  it("preserves non-default ports and normalizes explicit protocol defaults", () => {
    expect(parseGitRemoteLocation("https://git.example.com:8443/Team/App.git")).toEqual({
      transport: "https",
      host: "git.example.com",
      port: "8443",
      path: "Team/App",
    });
    expect(parseGitRemoteLocation("https://git.example.com:443/Team/App.git")).toEqual({
      transport: "https",
      host: "git.example.com",
      port: undefined,
      path: "Team/App",
    });
    expect(parseGitRemoteLocation("ssh://git@github.com:22/owner/repo.git")).toEqual({
      transport: "ssh",
      host: "github.com",
      port: undefined,
      path: "owner/repo",
    });
  });

  it("rejects schemes the daemon parser does not accept", () => {
    for (const repo of ["git://github.com/owner/repo", "ftp://host/repo", "file:///tmp/repo"]) {
      expect(isCompleteGitRemote(repo)).toBe(false);
      expect(parseGitRemoteLocation(repo)).toBeNull();
    }
  });

  it("parses and normalizes explicit remote ports", () => {
    expect(parseGitRemoteLocation("https://example.com:443/owner/repo.git")).toMatchObject({
      transport: "https",
      host: "example.com",
      path: "owner/repo",
    });
    expect(parseGitRemoteLocation("https://example.com:443/owner/repo.git")?.port).toBeUndefined();
    expect(parseGitRemoteLocation("ssh://git@example.com:2222/owner/repo.git")).toMatchObject({
      transport: "ssh",
      host: "example.com",
      port: "2222",
      path: "owner/repo",
    });
    expect(parseGitRemoteLocation("git@example.com:owner/repo.git")).toMatchObject({
      transport: "scp",
      host: "example.com",
      path: "owner/repo",
    });
  });
});
