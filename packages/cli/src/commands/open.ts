import { spawnProcess } from "@bytetrue/server";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import {
  buildAgentDeepLinkRoute,
  type AgentDeepLinkTarget,
} from "@bytetrue/protocol/agent-deep-link";
import { resolveLocalDaemonState, resolveTcpHostFromListen } from "./daemon/local-daemon.js";
import {
  buildDaemonConnectionCommandError,
  connectToDaemon,
  getDaemonHost,
  getExplicitDaemonHost,
} from "../utils/client.js";

/**
 * The daemon serves its bundled web UI on the same TCP port as `/ws`, so a TCP
 * daemon host doubles as its HTTP origin. Unix sockets, SSH tunnels, and relay
 * offers have no address a browser on this machine can reach.
 */
export function resolveWebUiOrigin(rawHost: string): string | null {
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed.startsWith("ssh://")) {
    return null;
  }

  const endpoint = trimmed.startsWith("tcp://") ? trimmed.slice("tcp://".length) : trimmed;
  const match = /^\[?([^\]/]+?)]?:(\d+)$/.exec(endpoint);
  if (!match) {
    return null;
  }

  const [, rawHostname, port] = match;
  const hostname = rawHostname === "0.0.0.0" ? "127.0.0.1" : rawHostname;
  const hostPart = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${hostPart}:${port}`;
}

function resolveLocalWebUiOrigin(): { origin: string | null; host: string } {
  const listen = resolveLocalDaemonState().listen;
  const host = resolveTcpHostFromListen(listen) ?? listen;
  return { origin: resolveWebUiOrigin(host), host };
}

function resolveWebUiOriginForHost(host: string | undefined): {
  origin: string | null;
  host: string;
} {
  const explicitHost = getExplicitDaemonHost(host);
  if (!explicitHost) {
    return resolveLocalWebUiOrigin();
  }
  return { origin: resolveWebUiOrigin(explicitHost), host: explicitHost };
}

/**
 * Mirrors `buildHostWorkspaceRoute` in `packages/app/src/utils/host-routes.ts`.
 * Workspace IDs are generated as `wks_<hex>` (packages/server/src/server/workspace-registry-model.ts),
 * so percent-encoding always suffices; the app's base64 path segment form only
 * exists for pre-v0.1.95 path-shaped IDs, which this fork does not carry.
 */
export function buildWorkspaceWebRoute(serverId: string, workspaceId: string): string {
  return `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}`;
}

function openInBrowser(url: string): void {
  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = process.env.ComSpec ?? "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  spawnProcess(command, args, { detached: true, stdio: "ignore", shell: false }).unref();
  process.stderr.write(`${url}\n`);
}

function reportWebUiUnavailable(host: string): void {
  process.stderr.write(
    `Cannot open the web app for ${host}: the daemon has no HTTP endpoint reachable from here.\n` +
      "Start it with `byspace daemon start` and open the Web UI URL it prints.\n",
  );
  process.exitCode = 1;
}

export async function openProjectInWebApp(projectPath: string): Promise<void> {
  const { origin, host } = resolveLocalWebUiOrigin();
  if (!origin) {
    reportWebUiUnavailable(host);
    return;
  }

  let client: DaemonClient;
  try {
    client = await connectToDaemon();
  } catch (error) {
    const failure = buildDaemonConnectionCommandError({ error });
    process.stderr.write(`${failure.message}\n${failure.details}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const serverId = client.getLastServerInfoMessage()?.serverId.trim();
    if (!serverId) {
      throw new Error("The daemon did not report a server ID.");
    }
    const result = await client.openProject(projectPath);
    if (result.error || !result.workspace) {
      throw new Error(result.error ?? `The daemon did not open a workspace for ${projectPath}`);
    }
    openInBrowser(`${origin}${buildWorkspaceWebRoute(serverId, result.workspace.id)}`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function openAgentInWebApp(
  target: AgentDeepLinkTarget,
  options: { host?: string } = {},
): Promise<void> {
  const { origin, host } = resolveWebUiOriginForHost(options.host);
  if (!origin) {
    reportWebUiUnavailable(host || getDaemonHost());
    return;
  }

  openInBrowser(`${origin}${buildAgentDeepLinkRoute(target)}`);
}
