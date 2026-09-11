/**
 * Plugin UI shim (upstream plugin system retired, issue 025 C6).
 *
 * The plugin runtime and registry are gone. These exports exist so shared
 * UI keeps its layout calls; everything renders nothing / returns empty /
 * reports no plugins. New code must not import from here.
 */
import type { ReactNode } from "react";

export function useHasPluginComposerPills(
  _serverId: string,
  _workspaceId: string,
  _agentId: string,
): false {
  return false;
}

export function PluginComposerPills(_props: Record<string, unknown>): ReactNode {
  return null;
}

export function PluginHeaderButtons(_props: Record<string, unknown>): ReactNode {
  return null;
}

export function usePluginTimelineMessages(): [] {
  return [];
}

export function useInstalledPlugins(): [] {
  return [];
}

export function usePluginCatalogSync(): void {}
