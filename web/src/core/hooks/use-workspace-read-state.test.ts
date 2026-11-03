import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { workspaceHasMarkableAgent } from "./use-workspace-read-state";

const TIMESTAMP = new Date("2026-11-02T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: "server-1",
  id: "agent",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  workspaceId: "ws-1",
  model: null,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function agents(...list: Array<Partial<Agent> & Pick<Agent, "id">>): Map<string, Agent> {
  return new Map(list.map((input) => [input.id, { ...AGENT_DEFAULTS, ...input }]));
}

describe("workspaceHasMarkableAgent", () => {
  it("is false for a workspace with no agents", () => {
    expect(workspaceHasMarkableAgent(undefined, "ws-1")).toBe(false);
    expect(workspaceHasMarkableAgent(agents({ id: "a", workspaceId: "ws-2" }), "ws-1")).toBe(false);
  });

  it("is true for a finished root agent", () => {
    expect(workspaceHasMarkableAgent(agents({ id: "a" }), "ws-1")).toBe(true);
    expect(workspaceHasMarkableAgent(agents({ id: "a", status: "closed" }), "ws-1")).toBe(true);
  });

  it("skips agents the daemon cannot mark", () => {
    const pending = { id: "p" } as Agent["pendingPermissions"][number];
    for (const blocked of [
      { status: "running" as const },
      { status: "error" as const },
      { status: "initializing" as const },
      { requiresAttention: true },
      { archivedAt: TIMESTAMP },
      { pendingPermissions: [pending] },
    ]) {
      expect(workspaceHasMarkableAgent(agents({ id: "a", ...blocked }), "ws-1")).toBe(false);
    }
  });

  it("counts only root agents", () => {
    // A subagent in the same workspace is not a root, whatever its status.
    expect(
      workspaceHasMarkableAgent(
        agents({ id: "root", status: "running" }, { id: "child", parentAgentId: "root" }),
        "ws-1",
      ),
    ).toBe(false);
    // A parent in another workspace makes the child this workspace's root.
    expect(
      workspaceHasMarkableAgent(
        agents(
          { id: "root", workspaceId: "ws-2", status: "running" },
          { id: "child", parentAgentId: "root" },
        ),
        "ws-1",
      ),
    ).toBe(true);
    // A parent the client does not hold, or one that is archived, resolves to no root.
    expect(workspaceHasMarkableAgent(agents({ id: "child", parentAgentId: "gone" }), "ws-1")).toBe(
      false,
    );
    expect(
      workspaceHasMarkableAgent(
        agents(
          { id: "root", workspaceId: "ws-2", archivedAt: TIMESTAMP },
          { id: "child", parentAgentId: "root" },
        ),
        "ws-1",
      ),
    ).toBe(false);
  });
});
