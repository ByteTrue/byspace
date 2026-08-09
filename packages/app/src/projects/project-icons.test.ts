import { describe, expect, it } from "vitest";
import { buildProjectIconRequestTarget, resolveProjectIconLookup } from "./project-icon-lookup";

describe("project icon lookup", () => {
  const target = { projectId: "prj_host_local", iconWorkingDir: "/projects/byspace" };

  it("uses the host-local project ID on capable hosts", () => {
    expect(resolveProjectIconLookup(target, true)).toEqual({
      kind: "project",
      projectId: "prj_host_local",
    });
  });

  it("keeps the legacy directory lookup for older hosts", () => {
    expect(resolveProjectIconLookup(target, false)).toEqual({
      kind: "legacy",
      cwd: "/projects/byspace",
    });
  });

  it("retains the host-local ID and custom revision in consumer targets", () => {
    const request = buildProjectIconRequestTarget("project-key", {
      serverId: "host-a",
      projectId: "prj_host_local",
      iconWorkingDir: "/projects/byspace",
      customIconRevision: "revision-2",
    });

    expect(request).toEqual({
      serverId: "host-a",
      projectKey: "project-key",
      projectId: "prj_host_local",
      iconWorkingDir: "/projects/byspace",
      customIconRevision: "revision-2",
    });
    expect(resolveProjectIconLookup(request, true)).toEqual({
      kind: "project",
      projectId: "prj_host_local",
    });
  });
});
