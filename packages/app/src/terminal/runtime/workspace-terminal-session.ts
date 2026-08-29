import type { TerminalState } from "@bytetrue/byspace-protocol/messages";

export interface WorkspaceTerminalSnapshots {
  get: (input: { terminalId: string }) => TerminalState | null;
  set: (input: { terminalId: string; state: TerminalState }) => void;
  clear: (input: { terminalId: string }) => void;
  prune: (input: { terminalIds: string[] }) => void;
}

export interface WorkspaceTerminalSizeClaims {
  get: (input: { terminalId: string }) => string | null;
  set: (input: { terminalId: string; claimIdentity: string }) => void;
}

export interface WorkspaceTerminalSession {
  scopeKey: string;
  snapshots: WorkspaceTerminalSnapshots;
  sizeClaims: WorkspaceTerminalSizeClaims;
}

interface WorkspaceTerminalSessionRecord {
  snapshotByTerminalId: Map<string, TerminalState>;
  sizeClaimByTerminalId: Map<string, string>;
  session: WorkspaceTerminalSession;
}

const sessionsByScopeKey = new Map<string, WorkspaceTerminalSessionRecord>();
const refCountByScopeKey = new Map<string, number>();

function createSnapshots(input: {
  snapshotByTerminalId: Map<string, TerminalState>;
}): WorkspaceTerminalSnapshots {
  return {
    get: ({ terminalId }) => input.snapshotByTerminalId.get(terminalId) ?? null,
    set: ({ terminalId, state }) => {
      input.snapshotByTerminalId.set(terminalId, state);
    },
    clear: ({ terminalId }) => {
      input.snapshotByTerminalId.delete(terminalId);
    },
    prune: ({ terminalIds }) => {
      const terminalIdSet = new Set(terminalIds);
      for (const terminalId of Array.from(input.snapshotByTerminalId.keys())) {
        if (!terminalIdSet.has(terminalId)) {
          input.snapshotByTerminalId.delete(terminalId);
        }
      }
    },
  };
}

function createSizeClaims(input: {
  sizeClaimByTerminalId: Map<string, string>;
}): WorkspaceTerminalSizeClaims {
  return {
    get: ({ terminalId }) => input.sizeClaimByTerminalId.get(terminalId) ?? null,
    set: ({ terminalId, claimIdentity }) => {
      input.sizeClaimByTerminalId.set(terminalId, claimIdentity);
    },
  };
}

export function getWorkspaceTerminalSession(input: { scopeKey: string }): WorkspaceTerminalSession {
  const existing = sessionsByScopeKey.get(input.scopeKey);
  if (existing) {
    return existing.session;
  }

  const snapshotByTerminalId = new Map<string, TerminalState>();
  const sizeClaimByTerminalId = new Map<string, string>();
  const session: WorkspaceTerminalSession = {
    scopeKey: input.scopeKey,
    snapshots: createSnapshots({
      snapshotByTerminalId,
    }),
    sizeClaims: createSizeClaims({
      sizeClaimByTerminalId,
    }),
  };

  sessionsByScopeKey.set(input.scopeKey, {
    snapshotByTerminalId,
    sizeClaimByTerminalId,
    session,
  });
  return session;
}

export function retainWorkspaceTerminalSession(input: { scopeKey: string }): void {
  const current = refCountByScopeKey.get(input.scopeKey) ?? 0;
  refCountByScopeKey.set(input.scopeKey, current + 1);
}

export function releaseWorkspaceTerminalSession(input: { scopeKey: string }): void {
  const current = refCountByScopeKey.get(input.scopeKey) ?? 0;
  if (current > 1) {
    refCountByScopeKey.set(input.scopeKey, current - 1);
    return;
  }
  refCountByScopeKey.delete(input.scopeKey);
  sessionsByScopeKey.delete(input.scopeKey);
}
