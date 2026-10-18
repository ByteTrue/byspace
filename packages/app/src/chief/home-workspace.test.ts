import { describe, expect, it } from "vitest";
import {
  deriveHomeWorkspaceStatusBucket,
  findHomeWorkspaceId,
  hasHostChiefRole,
  HOME_WORKSPACE_LABEL,
  isHomeWorkspace,
  resolveChiefTargetServerId,
} from "./home-workspace";

describe("isHomeWorkspace", () => {
  it("matches only the reserved byspace.home-workspace label", () => {
    expect(isHomeWorkspace({ labels: [HOME_WORKSPACE_LABEL] })).toBe(true);
    expect(isHomeWorkspace({ labels: ["other", HOME_WORKSPACE_LABEL] })).toBe(true);
    expect(isHomeWorkspace({ labels: ["other"] })).toBe(false);
    expect(isHomeWorkspace({ labels: [] })).toBe(false);
    expect(isHomeWorkspace(null)).toBe(false);
    expect(isHomeWorkspace(undefined)).toBe(false);
  });
});

describe("hasHostChiefRole", () => {
  it("detects chief in agentRoleNames or legacy agentRoles boolean", () => {
    expect(hasHostChiefRole({ agentRoleNames: ["chief", "researcher"] })).toBe(true);
    expect(hasHostChiefRole({ agentRoleNames: ["researcher"] })).toBe(false);
    expect(hasHostChiefRole({ agentRoles: true })).toBe(true);
    expect(hasHostChiefRole({ agentRoles: false })).toBe(false);
    expect(hasHostChiefRole(undefined)).toBe(false);
  });
});

describe("findHomeWorkspaceId", () => {
  it("returns the id of the workspace carrying the reserved label", () => {
    const id = findHomeWorkspaceId([
      { id: "wks_repo", labels: [] },
      { id: "wks_home", labels: [HOME_WORKSPACE_LABEL] },
    ]);
    expect(id).toBe("wks_home");
  });

  it("returns null when no workspace carries the reserved label", () => {
    expect(findHomeWorkspaceId([{ id: "wks_repo", labels: ["custom"] }])).toBeNull();
    expect(findHomeWorkspaceId(null)).toBeNull();
  });
});

describe("resolveChiefTargetServerId", () => {
  it("prefers the current route host when it is registered and supports chief", () => {
    expect(
      resolveChiefTargetServerId({
        pathname: "/h/srv_b/workspace/wks_1",
        hostServerIds: ["srv_a", "srv_b"],
        earliestOnlineServerId: "srv_a",
        isChiefSupported: () => true,
      }),
    ).toBe("srv_b");
  });

  it("falls back to the earliest online host that supports chief", () => {
    expect(
      resolveChiefTargetServerId({
        pathname: "/tunnels",
        hostServerIds: ["srv_old", "srv_new"],
        earliestOnlineServerId: "srv_old",
        isChiefSupported: (id) => id === "srv_new",
      }),
    ).toBe("srv_new");
  });
});

describe("deriveHomeWorkspaceStatusBucket", () => {
  it("returns done when workspace is absent or idle without active root agent activity", () => {
    expect(deriveHomeWorkspaceStatusBucket({ workspace: null })).toBe("done");
    expect(
      deriveHomeWorkspaceStatusBucket({
        workspace: { id: "wks_home", status: "done" },
      }),
    ).toBe("done");
  });

  it("prefers the workspace status when not done, otherwise falls back to root agent activity", () => {
    expect(
      deriveHomeWorkspaceStatusBucket({
        workspace: { id: "wks_home", status: "needs_input" },
        workspaceAgentActivity: new Map([
          ["wks_home", { status: "running", enteredAt: new Date(1000) }],
        ]),
      }),
    ).toBe("needs_input");

    expect(
      deriveHomeWorkspaceStatusBucket({
        workspace: { id: "wks_home", status: "done" },
        workspaceAgentActivity: new Map([
          ["wks_home", { status: "running", enteredAt: new Date(1000) }],
        ]),
      }),
    ).toBe("running");
  });
});
