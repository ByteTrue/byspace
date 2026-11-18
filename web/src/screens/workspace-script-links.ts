import { parseHostPort } from "@bytetrue/protocol/daemon-endpoints";
import type { WorkspaceScriptPayload } from "@bytetrue/protocol/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";

export interface WorkspaceScriptLinkTarget {
  label: string;
  url: string;
}

function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  return (
    normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "::1"
  );
}

function buildDirectServiceUrl(
  activeConnection: ActiveConnection | null,
  port: number | null,
): string | null {
  if (port === null) return null;
  if (activeConnection?.type !== "directTcp") {
    return `http://localhost:${port}`;
  }
  try {
    const { host, isIpv6 } = parseHostPort(activeConnection.endpoint);
    let base = host;
    if (isLoopbackHost(host)) {
      base = "localhost";
    } else if (isIpv6) {
      base = `[${host}]`;
    }
    return `http://${base}:${port}`;
  } catch {
    return `http://localhost:${port}`;
  }
}

// A running service is reachable at its own port on the daemon's host. Remote access goes
// through a tunnel, which forwards that port — the client needs no proxy route.
export function resolveWorkspaceScriptLink(input: {
  script: WorkspaceScriptPayload;
  activeConnection: ActiveConnection | null;
}): WorkspaceScriptLinkTarget | null {
  const { script, activeConnection } = input;
  if (script.type !== "service" || script.lifecycle !== "running") return null;
  const url = buildDirectServiceUrl(activeConnection, script.port);
  if (!url) return null;
  return { label: url.replace(/^https?:\/\//, ""), url };
}
