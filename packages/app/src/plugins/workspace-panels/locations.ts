/** Plugin workspace-panel location rules shim (issue 025 C6).
 *
 * No plugin panels exist, so every target supports every host and every
 * workspace key; the plugin panel location filter passes nothing.
 */

export function panelTargetSupportsHost(
  _serverId: string,
  _target: unknown,
  _destinationHost: unknown,
): true {
  return true;
}

export function panelTargetSupportsHostForWorkspaceKey(
  _workspaceKey: string,
  _target: unknown,
  _destinationHost: unknown,
): true {
  return true;
}

export function pluginPanelSupportsLocation(_panel: unknown, _location: unknown): false {
  return false;
}
