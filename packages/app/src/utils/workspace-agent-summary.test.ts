import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { buildWorkspaceAgentSummaryIndex } from "./workspace-agent-summary";

function agent(input: {
  id: string;
  workspaceId?: string;
  status?: Agent["status"];
  title?: string | null;
  updatedAt: string;
  lastActivityAt?: string;
  attentionTimestamp?: string | null;
  requiresAttention?: boolean;
  attentionReason?: Agent["attentionReason"];
  pendingPermissionCount?: number;
  archivedAt?: string | null;
  parentAgentId?: string | null;
}): Agent {
  return {
    serverId: "host-a",
    id: input.id,
    provider: "codex",
    status: input.status ?? "idle",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(input.updatedAt),
    lastUserMessageAt: null,
    lastActivityAt: new Date(input.lastActivityAt ?? input.updatedAt),
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
    pendingPermissions: Array.from({ length: input.pendingPermissionCount ?? 0 }, (_, index) => ({
      id: `permission-${index}`,
      provider: "codex",
      name: "shell",
      kind: "tool",
      input: {},
    })),
    persistence: null,
    title: input.title ?? null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp ? new Date(input.attentionTimestamp) : null,
    archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
  };
}

describe("workspace agent summary index", () => {
  it("summarizes every unarchived agent in a workspace", () => {
    const index = buildWorkspaceAgentSummaryIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            title: "Root task",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "permission",
          agent({
            id: "permission",
            title: "Run deployment",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:03:00.000Z",
            pendingPermissionCount: 1,
            parentAgentId: "root",
          }),
        ],
        [
          "review",
          agent({
            id: "review",
            title: "Review output",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:02:00.000Z",
            attentionTimestamp: "2026-06-01T10:02:00.000Z",
            requiresAttention: true,
            attentionReason: "finished",
            parentAgentId: "root",
          }),
        ],
        [
          "done",
          agent({
            id: "done",
            title: "Inspect code",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T09:59:00.000Z",
            parentAgentId: "root",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:04:00.000Z",
            requiresAttention: true,
            attentionReason: "error",
            archivedAt: "2026-06-01T10:04:00.000Z",
          }),
        ],
      ]),
    );

    const summary = index.get("workspace-a");
    expect(summary).toMatchObject({
      status: "needs_input",
      needsAttentionCount: 2,
      workingCount: 1,
      oldestAttentionAt: new Date("2026-06-01T10:02:00.000Z"),
      latestActivityAt: new Date("2026-06-01T10:03:00.000Z"),
    });
    expect(
      summary?.agents.map(({ agentId, depth, status }) => ({ agentId, depth, status })),
    ).toEqual([
      { agentId: "root", depth: 0, status: "running" },
      { agentId: "permission", depth: 1, status: "needs_input" },
      { agentId: "review", depth: 1, status: "attention" },
      { agentId: "done", depth: 1, status: "done" },
    ]);
  });

  it("treats a parent from another workspace as a root in this workspace", () => {
    const index = buildWorkspaceAgentSummaryIndex(
      new Map([
        [
          "parent",
          agent({
            id: "parent",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-b",
            status: "running",
            updatedAt: "2026-06-01T10:03:00.000Z",
            parentAgentId: "parent",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-b")?.agents).toMatchObject([
      { agentId: "child", parentAgentId: null, depth: 0, status: "running" },
    ]);
  });

  it("preserves status entry time until the agent status changes", () => {
    const previous = buildWorkspaceAgentSummaryIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );
    const sameStatus = buildWorkspaceAgentSummaryIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:05:00.000Z",
          }),
        ],
      ]),
      previous,
    );

    expect(sameStatus.get("workspace-a")?.agents[0]?.statusEnteredAt).toEqual(
      new Date("2026-06-01T10:00:00.000Z"),
    );

    const changedStatus = buildWorkspaceAgentSummaryIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:06:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
      ]),
      sameStatus,
    );

    expect(changedStatus.get("workspace-a")?.agents[0]?.statusEnteredAt).toEqual(
      new Date("2026-06-01T10:06:00.000Z"),
    );
  });
});
