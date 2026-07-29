import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@bytetrue/byspace-client/internal/daemon-client";
import { resolveWorkspaceScriptWorkspaceId } from "./shared.js";

function clientWithWorkspacePages(
  pages: Array<{
    entries: Array<{ id: string; workspaceDirectory: string }>;
    nextCursor: string | null;
  }>,
): DaemonClient {
  const fetchWorkspaces = vi.fn(async () => {
    const page = pages.shift();
    if (!page) throw new Error("Unexpected workspace page request");
    return {
      entries: page.entries,
      pageInfo: { nextCursor: page.nextCursor },
    };
  });
  return { fetchWorkspaces } as unknown as DaemonClient;
}

describe("resolveWorkspaceScriptWorkspaceId", () => {
  it("continues through every workspace page before resolving cwd", async () => {
    const client = clientWithWorkspacePages([
      {
        entries: [{ id: "wks_other", workspaceDirectory: "/tmp/other" }],
        nextCursor: "page-2",
      },
      {
        entries: [{ id: "wks_target", workspaceDirectory: "/tmp/target" }],
        nextCursor: null,
      },
    ]);

    await expect(resolveWorkspaceScriptWorkspaceId(client, { cwd: "/tmp/target" })).resolves.toBe(
      "wks_target",
    );
    expect(client.fetchWorkspaces).toHaveBeenNthCalledWith(2, {
      page: { limit: 200, cursor: "page-2" },
    });
  });

  it("rejects the same cwd referenced by workspaces on different pages", async () => {
    const client = clientWithWorkspacePages([
      {
        entries: [{ id: "wks_first", workspaceDirectory: "/tmp/shared" }],
        nextCursor: "page-2",
      },
      {
        entries: [{ id: "wks_second", workspaceDirectory: "/tmp/shared" }],
        nextCursor: null,
      },
    ]);

    await expect(
      resolveWorkspaceScriptWorkspaceId(client, { cwd: "/tmp/shared" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_AMBIGUOUS" });
  });
});
