import { describe, expect, it } from "vitest";
import {
  AGENT_ROLE_LABEL,
  AUTO_ARCHIVE_LABEL,
  ORCHESTRATION_CHATTER_SHIELD_LABEL,
  ORCHESTRATION_MISSION_ID_LABEL,
  ORCHESTRATION_ROLE_LABEL,
  ORCHESTRATION_THREAD_ID_LABEL,
  PARENT_AGENT_ID_LABEL,
  getOpenAgentTabLabel,
  getOrchestrationInfoFromLabels,
  isChatterShieldedAgent,
  isOrchestrationLabel,
  isReservedAgentLabel,
} from "./agent-labels.js";
import {
  AgentProfileSchema,
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  resolveAgentProfileTier,
} from "./messages.js";
import { WSOutboundMessageSchema as GeneratedWSOutboundMessageSchema } from "./generated/validation/ws-outbound.aot.js";

function sampleThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thr_0123456789abcdef",
    missionId: "msn_0123456789abcdef",
    title: "Protocol contracts",
    goal: "Add Phase 1 Chief schemas",
    acceptanceCriteria: ["Pure Zod schemas compile", "Unit tests pass"],
    ownedPaths: ["packages/protocol/src/messages.ts"],
    workspaceId: "wks_0123456789abcdef",
    cwd: "/repo/byspace",
    branch: "chief/thr-1",
    baseRef: "main",
    isolation: "worktree",
    status: "authoring",
    authorAgentId: "agt_author",
    verifierAgentId: "agt_verifier",
    authorProfileId: "prof_standard",
    verifierProfileId: "prof_strong",
    authorTier: "standard",
    verifierTier: "strong",
    authorAgentStatus: "running",
    verifierAgentStatus: "idle",
    verifyRejectCount: 0,
    rebaseAttempts: 0,
    lastProgressAt: "2026-11-25T13:55:00.000Z",
    createdAt: "2026-11-25T13:50:00.000Z",
    updatedAt: "2026-11-25T13:55:00.000Z",
    ...overrides,
  };
}

function sampleMission(overrides: Record<string, unknown> = {}) {
  return {
    id: "msn_0123456789abcdef",
    title: "Chief Phase 1",
    goal: "Coordinate protocol and runtime slices",
    chiefAgentId: "agt_chief",
    chiefAgentStatus: "idle",
    projectId: "prj_0123456789abcdef",
    baseWorkspaceId: "wks_0123456789abcdef",
    baseCwd: "/repo/byspace",
    baseBranch: "main",
    tier: "L2",
    status: "active",
    sharedLocks: { "packages/protocol/src/messages.ts": "thr_0123456789abcdef" },
    cursors: { agt_author: 1, agt_verifier: 0 },
    pendingDecision: null,
    systemAttention: null,
    threads: [sampleThread()],
    headSeq: 2,
    createdAt: "2026-11-25T13:50:00.000Z",
    updatedAt: "2026-11-25T13:55:00.000Z",
    ...overrides,
  };
}

describe("chief protocol schemas & orchestration labels", () => {
  it("reserves daemon-owned orchestration labels while keeping client labels editable", () => {
    expect(isOrchestrationLabel(ORCHESTRATION_MISSION_ID_LABEL)).toBe(true);
    expect(isOrchestrationLabel(ORCHESTRATION_THREAD_ID_LABEL)).toBe(true);
    expect(isOrchestrationLabel(ORCHESTRATION_ROLE_LABEL)).toBe(true);
    expect(isOrchestrationLabel(ORCHESTRATION_CHATTER_SHIELD_LABEL)).toBe(true);
    expect(isOrchestrationLabel("byspace.agent-role")).toBe(false);

    expect(isReservedAgentLabel(AGENT_ROLE_LABEL)).toBe(true);
    expect(isReservedAgentLabel(AUTO_ARCHIVE_LABEL)).toBe(true);
    expect(isReservedAgentLabel("byspace.schedule-id")).toBe(true);
    expect(isReservedAgentLabel(ORCHESTRATION_ROLE_LABEL)).toBe(true);

    expect(isReservedAgentLabel(PARENT_AGENT_ID_LABEL)).toBe(false);
    expect(isReservedAgentLabel(getOpenAgentTabLabel("web-1"))).toBe(false);
    expect(isReservedAgentLabel("team.custom")).toBe(false);

    const labels = {
      [ORCHESTRATION_MISSION_ID_LABEL]: "msn_1",
      [ORCHESTRATION_THREAD_ID_LABEL]: "thr_1",
      [ORCHESTRATION_ROLE_LABEL]: "verifier",
      [ORCHESTRATION_CHATTER_SHIELD_LABEL]: "true",
    };
    expect(getOrchestrationInfoFromLabels(labels)).toEqual({
      missionId: "msn_1",
      threadId: "thr_1",
      role: "verifier",
      chatterShield: true,
    });
    expect(isChatterShieldedAgent({ labels })).toBe(true);
    expect(isChatterShieldedAgent({ labels: {} })).toBe(false);
    expect(
      getOrchestrationInfoFromLabels({ [ORCHESTRATION_ROLE_LABEL]: "unknown" }).role,
    ).toBeNull();
  });

  it("supports explicit AgentProfile.tier with standard fallback", () => {
    const omitted = AgentProfileSchema.parse({
      id: "prof-default",
      name: "Default",
      provider: "claude",
    });
    expect(omitted.tier).toBeUndefined();
    expect(resolveAgentProfileTier(omitted)).toBe("standard");

    const strong = AgentProfileSchema.parse({
      id: "prof-strong",
      name: "Strong",
      provider: "codex",
      tier: "strong",
    });
    expect(strong.tier).toBe("strong");
    expect(resolveAgentProfileTier(strong)).toBe("strong");

    expect(
      AgentProfileSchema.safeParse({
        id: "prof-bad",
        name: "Bad",
        provider: "pi",
        tier: "ultra",
      }).success,
    ).toBe(false);
  });

  it("parses MutableDaemonConfig.chief defaults and patches", () => {
    const config = MutableDaemonConfigSchema.parse({
      agentProfiles: [
        { id: "fast-1", name: "Fast", provider: "pi", tier: "fast" },
        { id: "strong-1", name: "Strong", provider: "claude", tier: "strong" },
      ],
      chief: {
        defaultTier: "L1",
        roles: {
          author: { primaryProfileId: "fast-1", fallbackProfileIds: ["strong-1"] },
          verifier: { primaryProfileId: "strong-1" },
          integrator: null,
        },
        stall: {},
        landing: {},
      },
    });

    expect(config.chief).toMatchObject({
      defaultTier: "L1",
      stall: { softWarningSec: 600, hardRecoverySec: 1200 },
      landing: {
        requireHumanApproval: true,
        mode: "merge_local",
        strategy: "squash",
      },
    });

    const patch = MutableDaemonConfigPatchSchema.parse({
      chief: {
        landing: { mode: "open_pr", strategy: "rebase", requireHumanApproval: false },
        roles: { author: { fallbackProfileIds: ["strong-1"] }, integrator: null },
      },
    });
    expect(patch.chief?.landing).toEqual({
      mode: "open_pr",
      strategy: "rebase",
      requireHumanApproval: false,
    });
    expect(
      MutableDaemonConfigPatchSchema.safeParse({
        chief: { landing: { mode: "auto_push" } },
      }).success,
    ).toBe(false);
  });

  it("validates all Phase 1 dotted chief inbound requests", () => {
    const requests = [
      {
        type: "chief.mission.list.request",
        requestId: "req-list",
        statuses: ["active", "waiting_human"],
        includeCompleted: false,
      },
      {
        type: "chief.mission.get.request",
        requestId: "req-get",
        missionId: "msn_1",
        includeEvents: true,
        eventsLimit: 50,
        afterSeq: 0,
      },
      {
        type: "chief.mission.create.request",
        requestId: "req-create",
        goal: "Ship Chief Phase 1",
        title: "Phase 1",
        tier: "L1",
        baseCwd: "/repo/byspace",
      },
      {
        type: "chief.mission.upgrade.request",
        requestId: "req-upgrade",
        missionId: "msn_1",
        targetTier: "L2",
        dirtyPolicy: "carry_into_thread_1",
      },
      {
        type: "chief.mission.resolve_decision.request",
        requestId: "req-decide",
        missionId: "msn_1",
        decisionId: "dec_1",
        optionId: "approve_land",
        note: "Looks clean",
      },
      {
        type: "chief.thread.create.request",
        requestId: "req-thr-create",
        missionId: "msn_1",
        title: "Protocol",
        goal: "Implement schemas",
        acceptanceCriteria: ["AOT passes"],
        ownedPaths: ["packages/protocol/src/messages.ts"],
        isolation: "worktree",
      },
      {
        type: "chief.thread.submit.request",
        requestId: "req-submit",
        threadId: "thr_1",
        callerAgentId: "agt_author",
        summary: "Added schemas and tests",
        tests: "vitest green",
        changedFiles: ["packages/protocol/src/messages.ts"],
        commitSha: "abc1234",
      },
      {
        type: "chief.thread.verdict.request",
        requestId: "req-verdict",
        threadId: "thr_1",
        callerAgentId: "agt_verifier",
        outcome: "pass",
        summary: "Verified against contract",
        checkedCommands: ["npx vitest run src/chief-schemas.test.ts"],
      },
    ];

    for (const msg of requests) {
      const parsed = SessionInboundMessageSchema.safeParse(msg);
      expect(parsed.success, `failed for ${msg.type}`).toBe(true);
    }
  });

  it("validates all Phase 1 chief outbound responses and updates through zod-aot", () => {
    const mission = sampleMission({
      pendingDecision: {
        id: "dec_1",
        kind: "landing_approval",
        title: "Approve landing",
        summary: "Thread 1 passed verification",
        threadId: "thr_0123456789abcdef",
        options: [
          { id: "approve", label: "Land now", style: "primary" },
          { id: "reject", label: "Hold", style: "secondary" },
        ],
        createdAt: "2026-11-25T13:56:00.000Z",
      },
      systemAttention: {
        kind: "stall",
        severity: "warning",
        summary: "No progress for 600s",
        agentId: "agt_author",
        threadId: "thr_0123456789abcdef",
        since: "2026-11-25T13:56:00.000Z",
        autoActionTaken: null,
        incidentNotified: false,
        resolvedAt: null,
      },
    });
    const thread = mission.threads[0];
    const event = {
      seq: 1,
      ts: "2026-11-25T13:55:00.000Z",
      missionId: mission.id,
      threadId: thread.id,
      kind: "author_submitted",
      actorAgentId: "agt_author",
      targetAgentId: "agt_verifier",
      summary: "Submitted 2 files for verification",
    };

    const outboundMessages = [
      {
        type: "get_daemon_config_response",
        payload: {
          requestId: "cfg-1",
          config: {
            agentProfiles: [{ id: "prof-1", name: "Author", provider: "codex", tier: "standard" }],
            chief: {
              defaultTier: "L1",
              roles: { author: { primaryProfileId: "prof-1", fallbackProfileIds: [] } },
              stall: { softWarningSec: 600, hardRecoverySec: 1200 },
              landing: { requireHumanApproval: true, mode: "merge_local", strategy: "squash" },
            },
          },
        },
      },
      {
        type: "chief.mission.list.response",
        payload: { requestId: "r1", missions: [mission], error: null },
      },
      {
        type: "chief.mission.get.response",
        payload: { requestId: "r2", mission, events: [event], error: null },
      },
      {
        type: "chief.mission.create.response",
        payload: { requestId: "r3", mission, error: null },
      },
      {
        type: "chief.mission.upgrade.response",
        payload: {
          requestId: "r4",
          mission,
          createdThreadId: thread.id,
          error: null,
        },
      },
      {
        type: "chief.mission.resolve_decision.response",
        payload: { requestId: "r5", mission, error: null },
      },
      {
        type: "chief.thread.create.response",
        payload: { requestId: "r6", mission, thread, error: null },
      },
      {
        type: "chief.thread.submit.response",
        payload: {
          requestId: "r7",
          accepted: true,
          thread,
          ownershipViolations: [],
          error: null,
        },
      },
      {
        type: "chief.thread.verdict.response",
        payload: {
          requestId: "r8",
          accepted: true,
          escalatedToChief: false,
          thread,
          error: null,
        },
      },
      {
        type: "chief.mission.update",
        payload: { kind: "upsert", mission, latestEvent: event },
      },
      {
        type: "chief.mission.update",
        payload: { kind: "remove", missionId: mission.id },
      },
    ];

    for (const message of outboundMessages) {
      expect(
        SessionOutboundMessageSchema.safeParse(message).success,
        `zod parse failed for ${message.type}`,
      ).toBe(true);
      expect(
        GeneratedWSOutboundMessageSchema.safeParse({ type: "session", message }).success,
        `zod-aot parse failed for ${message.type}`,
      ).toBe(true);
    }
  });

  it("preserves landing approval parameters in outbound and generated schemas", () => {
    const pendingDecision = {
      id: "dec_landing",
      kind: "landing_approval",
      title: "Approve landing",
      summary: "Thread 1 passed verification",
      threadId: "thr_0123456789abcdef",
      options: [
        { id: "approve", label: "Land now", style: "primary" },
        { id: "hold", label: "Hold", style: "secondary" },
      ],
      createdAt: "2026-11-25T13:56:00.000Z",
      landingStrategy: "rebase",
      landingCommitMessage: "custom landing message",
      landingError: "post-landing persistence failed",
    };
    const message = {
      type: "chief.mission.get.response",
      payload: {
        requestId: "req-landing-decision",
        mission: sampleMission({ pendingDecision }),
        events: [],
        error: null,
      },
    };

    expect(SessionOutboundMessageSchema.parse(message)).toMatchObject({
      payload: { mission: { pendingDecision } },
    });
    expect(GeneratedWSOutboundMessageSchema.parse({ type: "session", message })).toMatchObject({
      message: { payload: { mission: { pendingDecision } } },
    });

    for (const invalid of [
      { landingStrategy: "invalid" },
      { landingCommitMessage: "" },
      { landingError: "" },
    ]) {
      expect(
        SessionOutboundMessageSchema.safeParse({
          ...message,
          payload: {
            ...message.payload,
            mission: sampleMission({
              pendingDecision: { ...pendingDecision, ...invalid },
            }),
          },
        }).success,
      ).toBe(false);
    }
  });

  it("allows only L1 and L2 upgrade targets while preserving L0 mission states", () => {
    const upgradeRequest = {
      type: "chief.mission.upgrade.request",
      requestId: "req-upgrade-tier",
      missionId: "msn_1",
      targetTier: "L1",
    };
    for (const targetTier of ["L1", "L2"] as const) {
      expect(
        SessionInboundMessageSchema.safeParse({
          ...upgradeRequest,
          targetTier,
        }).success,
        `failed for upgrade target ${targetTier}`,
      ).toBe(true);
    }

    expect(
      SessionInboundMessageSchema.safeParse({
        ...upgradeRequest,
        targetTier: "L0",
      }).success,
    ).toBe(false);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "chief.mission.create.request",
        requestId: "req-create-l0",
        goal: "Preserve an L0 mission",
        title: "L0 mission",
        tier: "L0",
        baseCwd: "/repo/byspace",
      }).success,
    ).toBe(true);
    expect(
      SessionOutboundMessageSchema.safeParse({
        type: "chief.mission.list.response",
        payload: {
          requestId: "req-l0-missions",
          missions: [sampleMission({ tier: "L0" })],
          error: null,
        },
      }).success,
    ).toBe(true);
  });

  it("validates Phase 2 chief requests with trusted or human callers", () => {
    const requests = [
      {
        type: "chief.thread.merge_check.request",
        requestId: "req-merge-check",
        threadId: "thr_1",
        missionId: "msn_1",
        callerAgentId: "agt_chief",
      },
      {
        type: "chief.thread.land.request",
        requestId: "req-land",
        threadId: "thr_1",
        callerAgentId: "agt_chief",
        strategy: "squash",
        commitMessage: "Land Protocol contracts",
      },
      {
        type: "chief.thread.cancel.request",
        requestId: "req-cancel",
        threadId: "thr_1",
        missionId: "msn_1",
        callerAgentId: "agt_chief",
        reason: "Superseded by another approach",
      },
      {
        type: "chief.agent.hotswap.request",
        requestId: "req-hotswap",
        agentId: "agt_author",
        threadId: "thr_1",
        profileId: "prof_strong",
        missionId: "msn_1",
        callerAgentId: "agt_chief",
        reason: "Provider quota exhausted",
      },
    ];

    for (const message of requests) {
      expect(
        SessionInboundMessageSchema.safeParse(message).success,
        `failed for ${message.type}`,
      ).toBe(true);
      const { callerAgentId, ...humanRequest } = message;
      expect(callerAgentId).toBe("agt_chief");
      expect(
        SessionInboundMessageSchema.safeParse(humanRequest).success,
        `human request failed for ${message.type}`,
      ).toBe(true);
    }

    const invalidRequests = [
      { ...requests[0], threadId: "" },
      { ...requests[1], strategy: "fast-forward" },
      { ...requests[1], commitMessage: undefined },
      { ...requests[2], reason: "" },
      { ...requests[3], profileId: undefined },
      { ...requests[3], reason: undefined },
    ];
    for (const message of invalidRequests) {
      expect(
        SessionInboundMessageSchema.safeParse(message).success,
        `unexpectedly accepted malformed ${message.type}`,
      ).toBe(false);
    }
  });

  it("validates Phase 2 chief responses through zod-aot and rejects malformed payloads", () => {
    const mission = sampleMission();
    const mergeCheck = {
      clean: true,
      targetRef: "main",
      targetSha: "abc1234",
      sourceRef: "chief/thr-1",
      sourceSha: "def5678",
      mergeTreeSha: "fedcba9",
      conflictingFiles: [],
      dirtyWorktree: false,
      aheadCount: 1,
      checkedAt: "2026-11-25T14:00:00.000Z",
    };
    const outboundMessages = [
      {
        type: "chief.thread.merge_check.response",
        payload: {
          requestId: "req-merge-check",
          accepted: true,
          mergeCheck,
          mission,
          error: null,
        },
      },
      {
        type: "chief.thread.land.response",
        payload: {
          requestId: "req-land",
          accepted: true,
          approvalRequired: false,
          mission,
          error: null,
        },
      },
      {
        type: "chief.thread.land.response",
        payload: {
          requestId: "req-land-approval",
          accepted: false,
          approvalRequired: true,
          mission: sampleMission({
            pendingDecision: {
              id: "dec_land",
              kind: "landing_approval",
              title: "Approve landing",
              summary: "Landing requires human approval",
              threadId: "thr_0123456789abcdef",
              createdAt: "2026-11-25T14:01:00.000Z",
            },
          }),
          error: null,
        },
      },
      {
        type: "chief.thread.cancel.response",
        payload: {
          requestId: "req-cancel",
          accepted: true,
          mission,
          error: null,
        },
      },
      {
        type: "chief.agent.hotswap.response",
        payload: {
          requestId: "req-hotswap",
          accepted: true,
          previousAgentId: "agt_author",
          replacementAgentId: "agt_replacement",
          profileId: "prof_strong",
          mission,
          error: null,
        },
      },
    ];

    for (const message of outboundMessages) {
      expect(
        SessionOutboundMessageSchema.safeParse(message).success,
        `zod parse failed for ${message.type}`,
      ).toBe(true);
      expect(
        GeneratedWSOutboundMessageSchema.safeParse({ type: "session", message }).success,
        `zod-aot parse failed for ${message.type}`,
      ).toBe(true);
    }

    const invalidResponses = [
      {
        ...outboundMessages[0],
        payload: { ...outboundMessages[0].payload, mergeCheck: undefined },
      },
      {
        ...outboundMessages[1],
        payload: { ...outboundMessages[1].payload, approvalRequired: undefined },
      },
      {
        ...outboundMessages[3],
        payload: { ...outboundMessages[3].payload, accepted: "true" },
      },
      {
        ...outboundMessages[4],
        payload: { ...outboundMessages[4].payload, previousAgentId: null },
      },
    ];
    for (const message of invalidResponses) {
      expect(SessionOutboundMessageSchema.safeParse(message).success).toBe(false);
      expect(GeneratedWSOutboundMessageSchema.safeParse({ type: "session", message }).success).toBe(
        false,
      );
    }
  });
});
