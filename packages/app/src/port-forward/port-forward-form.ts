export interface PortForwardHostChoice {
  serverId: string;
  label: string;
}

export interface PortForwardDraft {
  sourceServerId: string;
  targetServerId: string;
  targetPort: string;
  localPort: string;
}

export type PortForwardField = keyof PortForwardDraft;
export type PortForwardFieldError =
  | "source-required"
  | "target-required"
  | "hosts-must-differ"
  | "invalid-port";

export interface PreparedPortForward {
  sourceServerId: string;
  targetServerId: string;
  targetPort: number;
  localPort?: number;
}

export interface PortForwardValidation {
  value: PreparedPortForward | null;
  errors: Partial<Record<PortForwardField, PortForwardFieldError>>;
}

function parsePort(value: string, optional: boolean): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed && optional) return undefined;
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function createPortForwardDraft(hosts: readonly PortForwardHostChoice[]): PortForwardDraft {
  return {
    sourceServerId: hosts[0]?.serverId ?? "",
    targetServerId: hosts[1]?.serverId ?? "",
    targetPort: "",
    localPort: "",
  };
}

export function reconcilePortForwardDraft(
  draft: PortForwardDraft,
  hosts: readonly PortForwardHostChoice[],
): PortForwardDraft {
  const hostIds = new Set(hosts.map((host) => host.serverId));
  const sourceServerId = hostIds.has(draft.sourceServerId)
    ? draft.sourceServerId
    : (hosts[0]?.serverId ?? "");
  const targetServerId =
    hostIds.has(draft.targetServerId) && draft.targetServerId !== sourceServerId
      ? draft.targetServerId
      : (hosts.find((host) => host.serverId !== sourceServerId)?.serverId ?? "");

  if (sourceServerId === draft.sourceServerId && targetServerId === draft.targetServerId) {
    return draft;
  }
  return { ...draft, sourceServerId, targetServerId };
}

export function preparePortForward(draft: PortForwardDraft): PortForwardValidation {
  const errors: PortForwardValidation["errors"] = {};
  const sourceServerId = draft.sourceServerId.trim();
  const targetServerId = draft.targetServerId.trim();
  const targetPort = parsePort(draft.targetPort, false);
  const localPort = parsePort(draft.localPort, true);

  if (!sourceServerId) errors.sourceServerId = "source-required";
  if (!targetServerId) errors.targetServerId = "target-required";
  if (sourceServerId && sourceServerId === targetServerId) {
    errors.targetServerId = "hosts-must-differ";
  }
  if (targetPort === null) errors.targetPort = "invalid-port";
  if (localPort === null) errors.localPort = "invalid-port";

  if (Object.keys(errors).length > 0 || targetPort == null || localPort === null) {
    return { value: null, errors };
  }

  return {
    value: {
      sourceServerId,
      targetServerId,
      targetPort,
      ...(localPort === undefined ? {} : { localPort }),
    },
    errors,
  };
}
