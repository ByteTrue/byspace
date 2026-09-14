/** Plugin workspace-panel location rules shim (issue 025 C6).
 *
 * No plugin panels exist, so plugin targets no longer consult a registry.
 * Built-in panel host rules still apply: non-plugin targets delegate to
 * panelSupportsHost exactly as before.
 */

import type { PaneHost } from "@/panels/panel-manifest";
import { panelSupportsHost } from "@/panels/panel-manifest";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export function panelTargetSupportsHost(
  _serverId: string,
  target: WorkspaceTabTarget,
  host: PaneHost,
): boolean {
  if (target.kind === "plugin") return true;
  return panelSupportsHost(target.kind, host);
}

export function panelTargetSupportsHostForWorkspaceKey(
  _workspaceKey: string,
  target: WorkspaceTabTarget,
  host: PaneHost,
): boolean {
  return panelTargetSupportsHost("", target, host);
}
