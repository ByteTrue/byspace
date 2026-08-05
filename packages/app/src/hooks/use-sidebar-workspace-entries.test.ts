import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceAgentSummary } from "@/utils/workspace-agent-summary";
import {
  areSidebarWorkspaceSessionsEqual,
  selectSidebarWorkspaceSessions,
  type SidebarWorkspaceSession,
} from "./sidebar-workspaces-view-model";

function workspaceMap(): Map<string, WorkspaceDescriptor> {
  return new Map();
}

function summaryMap(): Map<string, WorkspaceAgentSummary> {
  return new Map();
}

function sidebarSession(input?: Partial<Omit<SidebarWorkspaceSession, "serverId">>) {
  return {
    workspaces: input?.workspaces ?? workspaceMap(),
    workspaceAgentSummaries: input?.workspaceAgentSummaries ?? summaryMap(),
  };
}

describe("sidebar workspace session selection", () => {
  it("selects only sessions needed by sidebar placements", () => {
    const hostA = sidebarSession();
    const hostB = sidebarSession();
    const unusedHost = sidebarSession();

    expect(
      selectSidebarWorkspaceSessions(
        {
          "host-a": hostA,
          "host-b": hostB,
          unused: unusedHost,
        },
        ["host-b", "missing", "host-a"],
      ),
    ).toEqual([
      {
        serverId: "host-b",
        workspaces: hostB.workspaces,
        workspaceAgentSummaries: hostB.workspaceAgentSummaries,
      },
      {
        serverId: "host-a",
        workspaces: hostA.workspaces,
        workspaceAgentSummaries: hostA.workspaceAgentSummaries,
      },
    ]);
  });

  it("ignores high-frequency session changes outside the sidebar indexes", () => {
    const workspaces = workspaceMap();
    const workspaceAgentSummaries = summaryMap();

    const previous = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaces, workspaceAgentSummaries }) },
      ["host-a"],
    );
    const next = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaces, workspaceAgentSummaries }) },
      ["host-a"],
    );

    expect(previous).not.toBe(next);
    expect(areSidebarWorkspaceSessionsEqual(previous, next)).toBe(true);
  });

  it("detects changes to a selected workspace or agent summary index", () => {
    const workspaceAgentSummaries = summaryMap();
    const previous = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaceAgentSummaries, workspaces: workspaceMap() }) },
      ["host-a"],
    );
    const next = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaceAgentSummaries, workspaces: workspaceMap() }) },
      ["host-a"],
    );

    expect(areSidebarWorkspaceSessionsEqual(previous, next)).toBe(false);
  });
});
