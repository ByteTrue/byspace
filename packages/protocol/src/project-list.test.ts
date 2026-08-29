import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("project list protocol", () => {
  it("parses the dotted request and optional project grouping key", () => {
    expect(
      SessionInboundMessageSchema.parse({ type: "project.list.request", requestId: "req-1" }),
    ).toEqual({ type: "project.list.request", requestId: "req-1" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "project.list.response",
        payload: {
          requestId: "req-1",
          projects: [
            {
              projectId: "prj_local",
              projectKey: "remote:https://example.com/o/repo",
              projectDisplayName: "repo",
              projectRootPath: "/repo",
              projectKind: "git",
            },
            {
              projectId: "legacy",
              projectDisplayName: "legacy",
              projectRootPath: "/legacy",
              projectKind: "non_git",
            },
          ],
        },
      }).payload.projects[1],
    ).not.toHaveProperty("projectKey");
  });
});
