/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonEventHandler } from "@bytetrue/client/internal/daemon-client";
import type { ChiefMissionSnapshot, ChiefThreadSnapshot } from "@bytetrue/protocol/messages";
import type { ChiefDaemonClient, ChiefMissionUpdatePayload } from "@/stores/chief-store";

const { runtimeState, navigateToAgentMock, daemonConfigState } = vi.hoisted(() => ({
  runtimeState: {
    client: null as ChiefDaemonClient | null,
    isConnected: true,
    connectionEpoch: 1,
  },
  navigateToAgentMock: vi.fn(),
  daemonConfigState: {
    landingStrategy: "squash" as "squash" | "merge" | "rebase",
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const table: Record<string, string> = {
        "chief.panel.untitledMission": "Untitled mission",
        "chief.panel.loadError": "Unable to load missions",
        "chief.panel.noThreads": "No execution threads yet.",
        "chief.panel.recentActivity": "Recent activity",
        "chief.panel.noEvents": "No activity recorded yet.",
        "chief.missionStatus.active": "Active",
        "chief.missionStatus.waiting_human": "Needs decision",
        "chief.missionStatus.completed": "Completed",
        "chief.missionStatus.failed": "Failed",
        "chief.missionStatus.canceled": "Canceled",
        "chief.threadStatus.queued": "Queued",
        "chief.threadStatus.authoring": "Authoring",
        "chief.threadStatus.verifying": "Verifying",
        "chief.threadStatus.needs_rebase": "Needs rebase",
        "chief.threadStatus.merge_checking": "Merge checking",
        "chief.threadStatus.ready_to_land": "Ready to land",
        "chief.threadStatus.landed": "Landed",
        "chief.threadStatus.blocked": "Blocked",
        "chief.threadStatus.failed": "Failed",
        "chief.threadStatus.canceled": "Canceled",
        "chief.isolation.none": "Shared",
        "chief.isolation.worktree": "Worktree",
        "chief.groups.needsAttention": "Needs attention ({{count}})",
        "chief.groups.readyToLand": "Ready to land ({{count}})",
        "chief.groups.inProgress": "In progress ({{count}})",
        "chief.groups.completed": "Completed ({{count}})",
        "chief.roles.author": "Author",
        "chief.roles.verifier": "Verifier",
        "chief.roles.integrator": "Integrator",
        "chief.thread.ownedPaths": "Owns {{paths}}{{extra}}",
        "chief.thread.rejectCount": "{{count}} rejected",
        "chief.thread.rebaseCount": "{{count}} rebase",
        "chief.verdict.pass": "Verified",
        "chief.verdict.reject": "Rejected",
        "chief.verdict.tainted": "Mutated",
        "chief.mergeCheck.dirtyWorktree": "Target worktree has uncommitted changes",
        "chief.mergeCheck.conflict": "Conflicts: {{files}}",
        "chief.attention.severity.warning": "Warning",
        "chief.attention.severity.fatal": "Action required",
        "chief.attention.kinds.quota_exhausted": "Quota exhausted",
        "chief.attention.kinds.rate_limited": "Rate limited",
        "chief.attention.kinds.auth_error": "Auth error",
        "chief.attention.kinds.process_crash": "Process crashed",
        "chief.attention.kinds.stall": "Stalled",
        "chief.attention.kinds.permission_blocked": "Permission required",
        "chief.attention.kinds.merge_conflict": "Merge conflict",
        "chief.attention.kinds.verify_escalated": "Verification escalated",
        "chief.attention.kinds.verifier_tier_blocked": "Verifier tier blocked",
        "chief.decision.badge": "Decision",
        "chief.decision.approveFallback": "Approve",
        "chief.decision.notePlaceholder": "Optional note...",
        "chief.decision.addNote": "Add note",
        "chief.decision.hideNote": "Hide note",
        "chief.decision.landingFailedTitle": "Landing failed",
        "chief.decision.landingFailedHelp":
          "This approval is resolved. Use Land on a ready thread to request new approval.",
        "chief.actions.openConversation": "Open",
        "chief.actions.upgradeToL1": "Add verifier (L1)",
        "chief.actions.upgradeToL2": "Split worktrees (L2)",
        "chief.actions.carryChangesToThread1": "Carry changes into Thread 1",
        "chief.actions.toggleActivity": "Toggle activity",
        "chief.actions.refresh": "Refresh",
        "chief.actions.hideCompleted": "Hide",
        "chief.actions.showCompleted": "Show",
        "chief.actions.recheck": "Recheck",
        "chief.actions.land": "Land",
        "chief.actions.cancelThread": "Cancel",
        "chief.actions.landConfirmTitle": "Land this thread?",
        "chief.actions.landConfirmMessage":
          "Land {{title}} into the base branch using a local {{strategy}} merge? Final landing requires human approval.",
        "chief.actions.cancelConfirmTitle": "Cancel this thread?",
        "chief.actions.cancelConfirmMessage":
          "Stop the workers for {{title}} and mark it canceled? The worktree and uncommitted changes will be kept.",
        "chief.errors.upgradeFailed": "Unable to upgrade mission",
        "chief.errors.threadActionFailed": "Thread action failed",
        "chief.errors.unknownError": "Unknown error",
        "settings.host.agentProfiles.tiers.fast": "Fast",
        "settings.host.agentProfiles.tiers.standard": "Standard",
        "settings.host.agentProfiles.tiers.strong": "Strong",
      };
      let text = table[key] ?? key;
      for (const [k, v] of Object.entries(values ?? {})) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }
      return text;
    },
  }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtimeState.client,
  useHostRuntimeIsConnected: () => runtimeState.isConnected,
  useHostRuntimeConnectionEpoch: () => runtimeState.connectionEpoch,
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: {
      chief: {
        landing: {
          mode: "merge_local",
          requireHumanApproval: true,
          strategy: daemonConfigState.landingStrategy,
        },
      },
    },
    isLoading: false,
    patchConfig: vi.fn(),
  }),
}));

vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: navigateToAgentMock,
}));

vi.mock("@/platform/alert", () => ({
  showAlert: vi.fn(),
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

import { useChiefStore } from "@/stores/chief-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ChiefMissionPanel, SoloAgentUpgradeAction } from "./chief-mission-panel";

const confirmDialogMock = vi.mocked(confirmDialog);

function makeThread(overrides: Partial<ChiefThreadSnapshot> = {}): ChiefThreadSnapshot {
  return {
    id: "thr-1",
    missionId: "msn-1",
    title: "Auth middleware",
    goal: "Add token validation",
    acceptanceCriteria: ["Unit tests pass"],
    ownedPaths: ["internal/auth/middleware.go"],
    workspaceId: "wks-1",
    cwd: "/repo/byspace",
    branch: "chief/thr-1",
    isolation: "worktree",
    status: "authoring",
    authorAgentId: "agt-author-1",
    verifierAgentId: "agt-verifier-1",
    authorTier: "standard",
    verifierTier: "strong",
    authorAgentStatus: "running",
    verifierAgentStatus: "idle",
    verifyRejectCount: 0,
    rebaseAttempts: 0,
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T10:05:00.000Z",
    ...overrides,
  };
}

function makeMission(overrides: Partial<ChiefMissionSnapshot> = {}): ChiefMissionSnapshot {
  return {
    id: "msn-1",
    title: "Refactor auth & billing",
    goal: "Split work across isolated threads with read-only review",
    chiefAgentId: "agt-chief",
    chiefAgentStatus: "idle",
    baseWorkspaceId: "wks-base",
    baseCwd: "/repo/byspace",
    tier: "L2",
    status: "waiting_human",
    pendingDecision: {
      id: "dec-1",
      kind: "landing_approval",
      title: "Approve landing Thread 2",
      summary: "Billing cleanup passed verification cleanly.",
      threadId: "thr-2",
      options: [
        { id: "approve", label: "Land now", style: "primary" },
        { id: "hold", label: "Hold", style: "secondary" },
      ],
      createdAt: "2026-11-25T10:06:00.000Z",
    },
    threads: [
      makeThread({
        id: "thr-1",
        title: "Blocked thread",
        status: "blocked",
        systemAttention: {
          kind: "verifier_tier_blocked",
          severity: "fatal",
          summary: "Verifier profile tier fast is lower than Author tier strong.",
          agentId: "agt-author-1",
          threadId: "thr-1",
          since: "2026-11-25T10:05:30.000Z",
        },
      }),
      makeThread({
        id: "thr-2",
        title: "Billing cleanup",
        status: "ready_to_land",
        authorAgentId: "agt-author-2",
        verifierAgentId: "agt-verifier-2",
        lastVerdict: {
          outcome: "pass",
          summary: "All tests pass without mutations.",
          verifiedAt: "2026-11-25T10:05:45.000Z",
        },
      }),
      makeThread({
        id: "thr-3",
        title: "Docs update",
        status: "authoring",
        authorAgentId: "agt-author-3",
      }),
    ],
    headSeq: 4,
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T10:06:00.000Z",
    ...overrides,
  };
}

function createHarness(initialMissions: ChiefMissionSnapshot[]) {
  const listeners = new Set<DaemonEventHandler>();

  const listChiefMissions = vi.fn<ChiefDaemonClient["listChiefMissions"]>(async () => ({
    requestId: "r-list",
    missions: initialMissions,
    error: null,
  }));
  const getChiefMission = vi.fn<ChiefDaemonClient["getChiefMission"]>(async () => ({
    requestId: "r-get",
    mission: initialMissions[0] ?? null,
    events: [],
    error: null,
  }));
  const resolveChiefDecision = vi.fn<ChiefDaemonClient["resolveChiefDecision"]>(async () => ({
    requestId: "r-resolve",
    mission: makeMission({ status: "active", pendingDecision: null, headSeq: 5 }),
    error: null,
  }));
  const upgradeChiefMission = vi.fn<ChiefDaemonClient["upgradeChiefMission"]>(async () => ({
    requestId: "r-upgrade",
    mission: makeMission({ tier: "L1", headSeq: 6 }),
    createdThreadId: null,
    error: null,
  }));
  const mergeCheckChiefThread = vi.fn<ChiefDaemonClient["mergeCheckChiefThread"]>(async () => ({
    requestId: "r-merge-check",
    accepted: true,
    mergeCheck: null,
    mission: makeMission({ status: "active", pendingDecision: null, headSeq: 6 }),
    error: null,
  }));
  const landChiefThread = vi.fn<ChiefDaemonClient["landChiefThread"]>(async () => ({
    requestId: "r-land",
    accepted: false,
    approvalRequired: true,
    mission: makeMission({ headSeq: 6 }),
    error: null,
  }));
  const cancelChiefThread = vi.fn<ChiefDaemonClient["cancelChiefThread"]>(async () => ({
    requestId: "r-cancel",
    accepted: true,
    mission: makeMission({ status: "active", pendingDecision: null, headSeq: 6 }),
    error: null,
  }));

  const client: ChiefDaemonClient = {
    listChiefMissions,
    getChiefMission,
    resolveChiefDecision,
    upgradeChiefMission,
    mergeCheckChiefThread,
    landChiefThread,
    cancelChiefThread,
    subscribe: vi.fn<ChiefDaemonClient["subscribe"]>((handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
  };

  return {
    client,
    listChiefMissions,
    getChiefMission,
    resolveChiefDecision,
    upgradeChiefMission,
    mergeCheckChiefThread,
    landChiefThread,
    cancelChiefThread,
    emitUpdate(payload: ChiefMissionUpdatePayload) {
      for (const listener of listeners) {
        listener({ type: "chief.mission.update", payload });
      }
    },
  };
}

describe("ChiefMissionPanel", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useChiefStore.getState().resetAll();
    navigateToAgentMock.mockReset();
    confirmDialogMock.mockReset();
    confirmDialogMock.mockResolvedValue(true);
    daemonConfigState.landingStrategy = "squash";

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    useChiefStore.getState().resetAll();
    vi.unstubAllGlobals();
  });

  async function renderPanel(instanceKey = "panel"): Promise<HTMLElement> {
    await act(async () => {
      root?.render(
        <ChiefMissionPanel key={instanceKey} serverId="srv-1" chiefAgentId="agt-chief" />,
      );
    });
    if (!container) throw new Error("Missing container");
    return container;
  }

  it("renders outcome-grouped threads, systemAttention strips, decision banner, and worker drill-downs", async () => {
    const harness = createHarness([makeMission()]);
    runtimeState.client = harness.client;

    const el = await renderPanel();

    expect(el.querySelector('[data-testid="chief-mission-goal"]')?.textContent).toContain(
      "Split work across isolated threads",
    );
    expect(el.querySelector('[data-testid="chief-thread-group-needsAttention"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-group-readyToLand"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-group-inProgress"]')).not.toBeNull();
    expect(
      el.querySelector('[data-testid="chief-thread-attention-verifier_tier_blocked"]')?.textContent,
    ).toContain("Verifier tier blocked");

    const openAuthor = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-thread-open-author-thr-1"]',
    );
    expect(openAuthor).not.toBeNull();
    act(() => {
      openAuthor?.click();
    });
    expect(navigateToAgentMock).toHaveBeenCalledWith({
      serverId: "srv-1",
      agentId: "agt-author-1",
      workspaceId: "wks-1",
    });

    const approveBtn = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-decision-option-approve"]',
    );
    expect(approveBtn).not.toBeNull();
    await act(async () => {
      approveBtn?.click();
    });

    expect(harness.resolveChiefDecision).toHaveBeenCalledWith({
      missionId: "msn-1",
      decisionId: "dec-1",
      optionId: "approve",
    });
    expect(el.querySelector('[data-testid="chief-decision-banner-dec-1"]')).toBeNull();
  });

  it("keeps an approved PostLandError visible after remount without approval controls", async () => {
    const initialMission = makeMission();
    const landingError =
      "PostLandError: landed SHA 1111111111111111111111111111111111111111 does not match expected SHA 2222222222222222222222222222222222222222; reconciliation required before retry.";
    const resolvedMission = makeMission({
      status: "active",
      headSeq: 5,
      pendingDecision: {
        ...initialMission.pendingDecision,
        id: "dec-1",
        kind: "landing_approval",
        title: "Approve landing Thread 2",
        summary: "Billing cleanup passed verification cleanly.",
        createdAt: "2026-11-25T10:06:00.000Z",
        resolvedAt: "2026-11-25T10:07:00.000Z",
        selectedOptionId: "approve",
        landingStrategy: "squash",
        landingCommitMessage: "Billing cleanup",
        landingError,
      },
    });
    const harness = createHarness([initialMission]);
    harness.resolveChiefDecision.mockResolvedValue({
      requestId: "r-dec-error",
      mission: resolvedMission,
      error: landingError,
    });
    runtimeState.client = harness.client;

    const el = await renderPanel("before-resolution");
    await act(async () => {
      (
        el.querySelector('[data-testid="chief-decision-option-approve"]') as HTMLButtonElement
      ).click();
    });

    const remounted = await renderPanel("after-resolution");
    const banner = remounted.querySelector('[data-testid="chief-decision-banner-dec-1"]');
    expect(banner?.getAttribute("role")).toBe("alert");
    expect(banner?.className).toContain("text-destructive");
    expect(banner?.textContent).toContain("Landing failed");
    expect(banner?.textContent).toContain(landingError);
    expect(remounted.querySelector('[data-testid="chief-decision-option-approve"]')).toBeNull();
    expect(remounted.querySelector('[data-testid="chief-decision-option-hold"]')).toBeNull();
    expect(remounted.querySelector('[data-testid="chief-decision-toggle-note"]')).toBeNull();
    expect(remounted.querySelector('[data-testid="chief-thread-land-thr-2"]')).not.toBeNull();
    expect(harness.resolveChiefDecision).toHaveBeenCalledTimes(1);
    expect(harness.resolveChiefDecision).toHaveBeenCalledWith({
      missionId: "msn-1",
      decisionId: "dec-1",
      optionId: "approve",
    });
    expect(harness.landChiefThread).not.toHaveBeenCalled();
    expect(
      useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.pendingDecision
        ?.landingError,
    ).toBe(landingError);
  });

  it("supports L0->L1/L2 upgrade triggers including dirty-checkout carry retry", async () => {
    const l0Mission = makeMission({
      tier: "L0",
      status: "active",
      pendingDecision: null,
      threads: [],
    });
    const harness = createHarness([l0Mission]);
    harness.upgradeChiefMission
      .mockRejectedValueOnce(new Error("dirty worktree requires dirtyPolicy"))
      .mockResolvedValueOnce({
        requestId: "r-upg-2",
        mission: makeMission({ tier: "L2", status: "active", pendingDecision: null, headSeq: 7 }),
        createdThreadId: "thr-1",
        error: null,
      });
    runtimeState.client = harness.client;

    const el = await renderPanel();

    expect(el.querySelector('[data-testid="chief-mission-upgrade-L1"]')).not.toBeNull();
    const upgradeL2Btn = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-mission-upgrade-L2"]',
    );
    await act(async () => {
      upgradeL2Btn?.click();
    });

    expect(el.querySelector('[data-testid="chief-mission-upgrade-error"]')).not.toBeNull();
    const carryBtn = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-mission-upgrade-carry-dirty"]',
    );
    expect(carryBtn).not.toBeNull();

    await act(async () => {
      carryBtn?.click();
    });

    expect(harness.upgradeChiefMission).toHaveBeenLastCalledWith({
      missionId: "msn-1",
      targetTier: "L2",
      dirtyPolicy: "carry_into_thread_1",
    });
    expect(el.querySelector('[data-testid="chief-mission-tier-badge"]')?.textContent).toBe("L2");
  });

  it("keeps a delayed dirty upgrade error and carry retry on its original mission", async () => {
    const missionA = makeMission({
      id: "msn-a",
      title: "Mission A",
      tier: "L0",
      status: "active",
      pendingDecision: null,
      threads: [],
    });
    const missionB = makeMission({
      id: "msn-b",
      title: "Mission B",
      tier: "L0",
      status: "active",
      pendingDecision: null,
      threads: [],
    });
    const harness = createHarness([missionA, missionB]);
    let rejectUpgrade!: (reason: Error) => void;
    const pendingUpgrade = new Promise<
      Awaited<ReturnType<ChiefDaemonClient["upgradeChiefMission"]>>
    >((_, reject) => {
      rejectUpgrade = reject;
    });
    harness.upgradeChiefMission.mockImplementation(async (options) => {
      if (options.missionId === "msn-a" && options.dirtyPolicy === undefined) {
        return pendingUpgrade;
      }
      return {
        requestId: "r-upgrade-" + options.missionId,
        mission: makeMission({
          ...(options.missionId === "msn-b" ? missionB : missionA),
          tier: options.targetTier,
          headSeq: 7,
        }),
        createdThreadId: null,
        error: null,
      };
    });
    runtimeState.client = harness.client;

    const el = await renderPanel();
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-mission-upgrade-L1"]')?.click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-mission-tab-msn-b"]')?.click();
    });
    const upgradeB = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-mission-upgrade-L2"]',
    );
    expect(upgradeB?.disabled).toBe(false);
    await act(async () => {
      upgradeB?.click();
    });
    expect(harness.upgradeChiefMission).toHaveBeenCalledWith({
      missionId: "msn-b",
      targetTier: "L2",
    });
    await act(async () => {
      rejectUpgrade(new Error("dirty worktree requires dirtyPolicy"));
    });
    await pendingUpgrade.catch(() => undefined);

    expect(el.querySelector('[data-testid="chief-mission-upgrade-error"]')).toBeNull();
    expect(el.querySelector('[data-testid="chief-mission-upgrade-carry-dirty"]')).toBeNull();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-mission-tab-msn-a"]')?.click();
    });
    expect(el.querySelector('[data-testid="chief-mission-upgrade-error"]')?.textContent).toContain(
      "dirty worktree requires dirtyPolicy",
    );
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="chief-mission-upgrade-carry-dirty"]',
      )?.click();
    });

    expect(harness.upgradeChiefMission).toHaveBeenLastCalledWith({
      missionId: "msn-a",
      targetTier: "L1",
      dirtyPolicy: "carry_into_thread_1",
    });
    expect(harness.upgradeChiefMission).not.toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "msn-b",
        dirtyPolicy: "carry_into_thread_1",
      }),
    );
    expect(el.querySelector('[data-testid="chief-mission-tier-badge"]')?.textContent).toBe("L1");
  });

  it("updates live when chief.mission.update arrives over WebSocket", async () => {
    const harness = createHarness([
      makeMission({
        status: "active",
        pendingDecision: null,
        threads: [makeThread({ id: "thr-1", status: "authoring" })],
      }),
    ]);
    runtimeState.client = harness.client;

    const el = await renderPanel();
    expect(el.querySelector('[data-testid="chief-thread-group-readyToLand"]')).toBeNull();

    await act(async () => {
      harness.emitUpdate({
        kind: "upsert",
        mission: makeMission({
          status: "active",
          pendingDecision: null,
          headSeq: 8,
          threads: [makeThread({ id: "thr-1", status: "ready_to_land" })],
        }),
      });
    });

    expect(el.querySelector('[data-testid="chief-thread-group-readyToLand"]')).not.toBeNull();
  });

  it("rechecks a ready thread, prevents duplicates, and keeps other threads actionable", async () => {
    const readyThread = makeThread({
      id: "thr-2",
      title: "Billing cleanup",
      status: "ready_to_land",
    });
    const otherReadyThread = makeThread({
      id: "thr-3",
      title: "Docs cleanup",
      status: "ready_to_land",
    });
    const initialMission = makeMission({
      status: "active",
      pendingDecision: null,
      threads: [readyThread, otherReadyThread],
    });
    const harness = createHarness([initialMission]);
    let resolveMergeCheck!: (
      value: Awaited<ReturnType<ChiefDaemonClient["mergeCheckChiefThread"]>>,
    ) => void;
    const mergeCheckResponse = new Promise<
      Awaited<ReturnType<ChiefDaemonClient["mergeCheckChiefThread"]>>
    >((resolve) => {
      resolveMergeCheck = resolve;
    });
    harness.mergeCheckChiefThread.mockReturnValue(mergeCheckResponse);
    runtimeState.client = harness.client;
    const el = await renderPanel();

    const recheck = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-thread-recheck-thr-2"]',
    );
    const otherRecheck = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-thread-recheck-thr-3"]',
    );
    expect(recheck).not.toBeNull();
    expect(otherRecheck).not.toBeNull();
    act(() => {
      recheck?.click();
    });

    expect(harness.mergeCheckChiefThread).toHaveBeenCalledTimes(1);
    expect(harness.mergeCheckChiefThread).toHaveBeenCalledWith({
      threadId: "thr-2",
      missionId: "msn-1",
    });
    expect(recheck?.disabled).toBe(true);
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-land-thr-2"]')?.disabled,
    ).toBe(true);
    expect(otherRecheck?.disabled).toBe(false);
    act(() => {
      recheck?.click();
    });
    expect(harness.mergeCheckChiefThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMergeCheck({
        requestId: "r-merge-pending",
        accepted: true,
        mergeCheck: null,
        mission: makeMission({
          status: "active",
          pendingDecision: null,
          headSeq: 5,
          threads: [
            makeThread({
              id: "thr-2",
              title: "Billing cleanup",
              status: "ready_to_land",
              mergeCheck: {
                clean: true,
                targetRef: "main",
                sourceRef: "chief/thr-2",
                checkedAt: "2026-11-25T10:07:00.000Z",
              },
            }),
            otherReadyThread,
          ],
        }),
        error: null,
      });
    });
    expect(recheck?.disabled).toBe(false);
    expect(useChiefStore.getState().servers["srv-1"]?.missions.get("msn-1")?.headSeq).toBe(5);
  });

  it.each([{ status: "merge_checking" }, { status: "needs_rebase" }] as const)(
    "rechecks a $status thread with the same request and does not offer Land",
    async ({ status }) => {
      const thread = makeThread({
        id: `thr-${status}`,
        title: "Retry transient dry-run failure",
        status,
      });
      const harness = createHarness([
        makeMission({ status: "active", pendingDecision: null, threads: [thread] }),
      ]);
      harness.mergeCheckChiefThread.mockResolvedValue({
        requestId: `r-${status}-retry`,
        accepted: true,
        mergeCheck: null,
        mission: makeMission({
          status: "active",
          pendingDecision: null,
          headSeq: 5,
          threads: [thread],
        }),
        error: null,
      });
      runtimeState.client = harness.client;
      const el = await renderPanel();

      const recheck = el.querySelector<HTMLButtonElement>(
        `[data-testid="chief-thread-recheck-thr-${status}"]`,
      );
      expect(recheck?.textContent).toBe("Recheck");
      expect(el.querySelector(`[data-testid="chief-thread-land-thr-${status}"]`)).toBeNull();

      await act(async () => {
        recheck?.click();
      });

      expect(harness.mergeCheckChiefThread).toHaveBeenCalledWith({
        threadId: `thr-${status}`,
        missionId: "msn-1",
      });
    },
  );

  it("loads activity once on open and fetches an uncached selected mission without stale events", async () => {
    const missionA = makeMission({
      id: "msn-a",
      title: "Mission A",
      pendingDecision: null,
      threads: [],
      headSeq: 1,
    });
    const missionB = makeMission({
      id: "msn-b",
      title: "Mission B",
      pendingDecision: null,
      threads: [],
      headSeq: 2,
    });
    const harness = createHarness([missionA, missionB]);
    harness.getChiefMission.mockImplementation(async ({ missionId }) => ({
      requestId: `r-get-${missionId}`,
      mission: missionId === "msn-b" ? missionB : missionA,
      events: [
        {
          seq: missionId === "msn-b" ? 2 : 1,
          ts: "2026-11-25T10:00:00.000Z",
          missionId,
          kind: "mission_created",
          summary: missionId === "msn-b" ? "Mission B activity" : "Mission A activity",
        },
      ],
      error: null,
    }));
    runtimeState.client = harness.client;
    const el = await renderPanel();

    expect(harness.getChiefMission).not.toHaveBeenCalled();
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-mission-events-toggle"]')?.click();
    });

    expect(harness.getChiefMission).toHaveBeenCalledTimes(1);
    expect(harness.getChiefMission).toHaveBeenLastCalledWith({
      missionId: "msn-a",
      includeEvents: true,
      eventsLimit: 50,
    });
    expect(el.querySelector('[data-testid="chief-mission-events"]')?.textContent).toContain(
      "Mission A activity",
    );

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-mission-tab-msn-b"]')?.click();
    });

    expect(harness.getChiefMission).toHaveBeenCalledTimes(2);
    expect(harness.getChiefMission).toHaveBeenLastCalledWith({
      missionId: "msn-b",
      includeEvents: true,
      eventsLimit: 50,
    });
    const events = el.querySelector('[data-testid="chief-mission-events"]');
    expect(events?.textContent).toContain("Mission B activity");
    expect(events?.textContent).not.toContain("Mission A activity");

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-mission-tab-msn-b"]')?.click();
    });
    expect(harness.getChiefMission).toHaveBeenCalledTimes(2);
  });

  it("treats approval-required landing as a pending human decision with the default squash strategy", async () => {
    const readyThread = makeThread({
      id: "thr-2",
      title: "Billing cleanup",
      status: "ready_to_land",
    });
    const harness = createHarness([
      makeMission({ status: "active", pendingDecision: null, threads: [readyThread] }),
    ]);
    harness.landChiefThread.mockResolvedValue({
      requestId: "r-land-approval",
      accepted: false,
      approvalRequired: true,
      mission: makeMission({
        status: "waiting_human",
        headSeq: 5,
        pendingDecision: {
          id: "dec-land",
          kind: "landing_approval",
          title: "Approve landing Billing cleanup",
          summary: "The merge check passed.",
          threadId: "thr-2",
          options: [{ id: "approve", label: "Land now", style: "primary" }],
          createdAt: "2026-11-25T10:07:00.000Z",
        },
        threads: [readyThread],
      }),
      error: null,
    });
    runtimeState.client = harness.client;
    const el = await renderPanel();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-land-thr-2"]')?.click();
    });

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: "Land", destructive: false }),
    );
    expect(harness.landChiefThread).toHaveBeenCalledWith({
      threadId: "thr-2",
      missionId: "msn-1",
      strategy: "squash",
      commitMessage: "Billing cleanup",
    });
    expect(el.querySelector('[data-testid="chief-decision-banner-dec-land"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-error-thr-2"]')).toBeNull();
  });

  it("uses the configured landing strategy and renders a landed thread without actions", async () => {
    daemonConfigState.landingStrategy = "merge";
    const readyThread = makeThread({
      id: "thr-2",
      title: "Billing cleanup",
      status: "ready_to_land",
    });
    const harness = createHarness([
      makeMission({ status: "active", pendingDecision: null, threads: [readyThread] }),
    ]);
    harness.landChiefThread.mockResolvedValue({
      requestId: "r-landed",
      accepted: true,
      approvalRequired: false,
      mission: makeMission({
        status: "active",
        pendingDecision: null,
        headSeq: 5,
        threads: [makeThread({ ...readyThread, status: "landed" })],
      }),
      error: null,
    });
    runtimeState.client = harness.client;
    const el = await renderPanel();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-land-thr-2"]')?.click();
    });

    expect(harness.landChiefThread).toHaveBeenCalledWith({
      threadId: "thr-2",
      missionId: "msn-1",
      strategy: "merge",
      commitMessage: "Billing cleanup",
    });
    expect(el.querySelector('[data-testid="chief-thread-group-completed"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-status-thr-2"]')?.textContent).toBe(
      "Landed",
    );
    expect(el.querySelector('[data-testid="chief-thread-recheck-thr-2"]')).toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-land-thr-2"]')).toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-cancel-thr-2"]')).toBeNull();
  });

  it("cancels an active non-terminal thread after confirmation without offering land actions", async () => {
    const activeThread = makeThread({
      id: "thr-active",
      title: "Stuck authoring work",
      status: "authoring",
    });
    const harness = createHarness([
      makeMission({ status: "active", pendingDecision: null, threads: [activeThread] }),
    ]);
    harness.cancelChiefThread.mockResolvedValue({
      requestId: "r-cancel-active",
      accepted: true,
      mission: makeMission({
        status: "active",
        pendingDecision: null,
        headSeq: 5,
        threads: [makeThread({ ...activeThread, status: "canceled" })],
      }),
      error: null,
    });
    runtimeState.client = harness.client;
    const el = await renderPanel();

    expect(el.querySelector('[data-testid="chief-thread-recheck-thr-active"]')).toBeNull();
    expect(el.querySelector('[data-testid="chief-thread-land-thr-active"]')).toBeNull();
    const cancel = el.querySelector<HTMLButtonElement>(
      '[data-testid="chief-thread-cancel-thr-active"]',
    );
    expect(cancel).not.toBeNull();

    await act(async () => {
      cancel?.click();
    });

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        message: expect.stringContaining("uncommitted changes will be kept"),
      }),
    );
    expect(harness.cancelChiefThread).toHaveBeenCalledWith({
      threadId: "thr-active",
      missionId: "msn-1",
      reason: "Canceled by user from mission panel",
    });
    expect(el.querySelector('[data-testid="chief-thread-status-thr-active"]')?.textContent).toBe(
      "Canceled",
    );
    expect(el.querySelector('[data-testid="chief-thread-cancel-thr-active"]')).toBeNull();
  });

  it.each(["landed", "canceled", "failed"] as const)(
    "does not offer Cancel for terminal %s threads",
    async (status) => {
      const terminalThread = makeThread({ id: `thr-${status}`, status });
      const harness = createHarness([
        makeMission({
          status: status === "failed" ? "failed" : "completed",
          pendingDecision: null,
          threads: [terminalThread],
        }),
      ]);
      runtimeState.client = harness.client;
      const el = await renderPanel();

      expect(el.querySelector(`[data-testid="chief-thread-row-thr-${status}"]`)).not.toBeNull();
      expect(el.querySelector(`[data-testid="chief-thread-cancel-thr-${status}"]`)).toBeNull();
    },
  );

  it("requires cancellation confirmation, preserves work, and renders the canceled state", async () => {
    confirmDialogMock.mockResolvedValueOnce(false);
    const readyThread = makeThread({
      id: "thr-2",
      title: "Billing cleanup",
      status: "ready_to_land",
    });
    const harness = createHarness([
      makeMission({ status: "active", pendingDecision: null, threads: [readyThread] }),
    ]);
    harness.cancelChiefThread.mockResolvedValue({
      requestId: "r-canceled",
      accepted: true,
      mission: makeMission({
        status: "active",
        pendingDecision: null,
        headSeq: 5,
        threads: [makeThread({ ...readyThread, status: "canceled" })],
      }),
      error: null,
    });
    runtimeState.client = harness.client;
    const el = await renderPanel();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-cancel-thr-2"]')?.click();
    });
    expect(harness.cancelChiefThread).not.toHaveBeenCalled();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-cancel-thr-2"]')?.click();
    });
    expect(confirmDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        destructive: true,
        message: expect.stringContaining("uncommitted changes will be kept"),
      }),
    );
    expect(harness.cancelChiefThread).toHaveBeenCalledWith({
      threadId: "thr-2",
      missionId: "msn-1",
      reason: "Canceled by user from mission panel",
    });
    expect(el.querySelector('[data-testid="chief-thread-status-thr-2"]')?.textContent).toBe(
      "Canceled",
    );
    expect(el.querySelector('[data-testid="chief-thread-cancel-thr-2"]')).toBeNull();
  });

  it("shows row-scoped action errors and clears them on a successful retry", async () => {
    const readyThread = makeThread({
      id: "thr-2",
      title: "Billing cleanup",
      status: "ready_to_land",
    });
    const harness = createHarness([
      makeMission({ status: "active", pendingDecision: null, threads: [readyThread] }),
    ]);
    harness.mergeCheckChiefThread
      .mockRejectedValueOnce(new Error("merge check unavailable"))
      .mockResolvedValueOnce({
        requestId: "r-merge-retry",
        accepted: true,
        mergeCheck: null,
        mission: makeMission({
          status: "active",
          pendingDecision: null,
          headSeq: 5,
          threads: [readyThread],
        }),
        error: null,
      });
    runtimeState.client = harness.client;
    const el = await renderPanel();

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-recheck-thr-2"]')?.click();
    });
    expect(el.querySelector('[data-testid="chief-thread-error-thr-2"]')?.textContent).toContain(
      "merge check unavailable",
    );

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[data-testid="chief-thread-recheck-thr-2"]')?.click();
    });
    expect(harness.mergeCheckChiefThread).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="chief-thread-error-thr-2"]')).toBeNull();
  });

  it("renders solo agent L0->L1/L2 upgrade trigger when agent is not yet at L2", async () => {
    const harness = createHarness([]);
    runtimeState.client = harness.client;

    await act(async () => {
      root?.render(<SoloAgentUpgradeAction serverId="srv-1" agentId="agt-solo" />);
    });
    expect(container?.querySelector('[data-testid="solo-agent-upgrade-trigger"]')).not.toBeNull();

    useChiefStore.getState().applyMissionUpdate("srv-1", {
      kind: "upsert",
      mission: makeMission({
        tier: "L2",
        threads: [makeThread({ authorAgentId: "agt-solo" })],
      }),
    });
    await act(async () => {
      root?.render(<SoloAgentUpgradeAction serverId="srv-1" agentId="agt-solo" />);
    });
    expect(container?.querySelector('[data-testid="solo-agent-upgrade-trigger"]')).toBeNull();
  });
});
