import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { View } from "react-native";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  buildHostAgentDetailRoute,
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
  parseWorkspaceOpenIntent,
} from "@/utils/host-routes";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { isChiefSessionVisible } from "./chief-visibility";
import { useChiefStore } from "./chief-store";
import { useChiefAgent } from "./use-chief-agent";
import { ChiefFab } from "./chief-fab";
import { ChiefFloatingWindow } from "./chief-floating-window";

const E2E_STORAGE_KEY = "@byspace:e2e";

function useIsE2E(): boolean {
  const [isE2E, setIsE2E] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(E2E_STORAGE_KEY) != null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const check = () => {
      try {
        setIsE2E(globalThis.localStorage?.getItem(E2E_STORAGE_KEY) != null);
      } catch {
        // storage unavailable; keep the initial value
      }
    };
    globalThis.addEventListener?.("storage", check);
    return () => globalThis.removeEventListener?.("storage", check);
  }, []);
  return isE2E;
}

/**
 * Orchestrates the Chief FAB + floating window. Mounted once in the root
 * layout; renders on every screen.
 *
 * Route suppression: the entry goes away wherever the Chief session is already
 * the thing on screen — the maximized window and the compact tap both land on
 * a workspace route showing it as a pane tab.
 *
 * E2E: hidden entirely — specs seed localStorage "@byspace:e2e" and the FAB
 * would otherwise intercept pointer events over the composer area.
 */
export const ChiefPanelHost = memo(function ChiefPanelHost(): ReactElement | null {
  const pathname = usePathname();
  const isE2E = useIsE2E();
  const router = useRouter();
  const hosts = useHosts();
  const isCompact = useIsCompactFormFactor();
  const isOpen = useChiefStore((state) => state.isOpen);
  const retryCount = useChiefStore((state) => state.retryCount);
  const toggle = useChiefStore((state) => state.toggle);
  const close = useChiefStore((state) => state.close);

  // Use the first connected host as the "current" host. The host switcher in
  // the floating window navigates to a different host root.
  const pathServerId = useMemo(() => parseServerIdFromPathname(pathname), [pathname]);
  const earliestOnlineServerId = getHostRuntimeStore().getEarliestOnlineHostServerId();
  const currentServerId = useMemo(() => {
    if (pathServerId && hosts.some((host) => host.serverId === pathServerId)) {
      return pathServerId;
    }
    return earliestOnlineServerId ?? hosts[0]?.serverId ?? pathServerId;
  }, [pathServerId, earliestOnlineServerId, hosts]);

  // Resolve the Chief agent only once the window is open (or on compact
  // layouts where the FAB navigates straight to the agent page): the hook's
  // workspace/agent fetches otherwise fire on every app load and disturb
  // e2e directory-start accounting.
  const chiefState = useChiefAgent(currentServerId, {
    enabled: isOpen || isCompact,
    retryCount,
  });
  const agent = chiefState.tag === "ready" ? chiefState.agent : null;
  // When the hook fell back to a different host, use that host's id for the
  // pane content so the embedded panel can resolve its daemon connection.
  const effectiveServerId = chiefState.tag === "ready" ? chiefState.serverId : currentServerId;

  const handleFabPress = useCallback(() => {
    if (isCompact) {
      // On mobile, navigate directly to the agent page instead of a floating window.
      if (agent && effectiveServerId) {
        router.push(buildHostAgentDetailRoute(effectiveServerId, agent.agentId, agent.workspaceId));
      }
      return;
    }
    toggle();
  }, [isCompact, agent, effectiveServerId, router, toggle]);

  // Manual retry for transient daemon errors: a retry counter in the chief
  // store re-triggers the resolve effect in the hook.
  const handleRetry = useCallback(() => {
    useChiefStore.getState().requestRetry();
  }, []);

  const routeWorkspace = useMemo(() => parseHostWorkspaceRouteFromPathname(pathname), [pathname]);
  const shownWorkspaceKey = useMemo(
    () =>
      routeWorkspace
        ? buildWorkspaceTabPersistenceKey({
            serverId: routeWorkspace.serverId,
            workspaceId: routeWorkspace.workspaceId,
          })
        : null,
    [routeWorkspace],
  );
  const shownLayout = useWorkspaceLayoutStore((state) =>
    shownWorkspaceKey ? state.layoutByWorkspace[shownWorkspaceKey] : undefined,
  );
  // A tab that is on its way in: the route's own intent, before the layout has
  // picked it up. Without this the entry flashes for a frame after maximizing.
  const pendingOpenIntent = useGlobalSearchParams<{ open?: string }>().open;
  const pendingAgentId = useMemo(() => {
    const intent = parseWorkspaceOpenIntent(
      typeof pendingOpenIntent === "string" ? pendingOpenIntent : null,
    );
    return intent?.kind === "agent" ? intent.agentId : null;
  }, [pendingOpenIntent]);
  const chiefAgentId = agent?.agentId ?? null;
  const isChiefOnScreen =
    (chiefAgentId !== null && pendingAgentId === chiefAgentId) ||
    isChiefSessionVisible({
      layout: shownLayout,
      chiefAgentId,
      focusedPaneOnly: isCompact,
    });

  // Feature gate: daemons without built-in agent roles have no Chief to
  // open — hide the entry point entirely instead of showing a dead FAB.
  const supportsAgentRoles = useSessionStore((state) =>
    Boolean(state.sessions[currentServerId]?.serverInfo?.features?.agentRoles),
  );

  if (!currentServerId || isE2E || !supportsAgentRoles) return null;

  const showWindow = isOpen && !isCompact && !isChiefOnScreen;

  return (
    <View style={containerStyle} pointerEvents="box-none">
      {showWindow ? (
        <ChiefFloatingWindow
          serverId={effectiveServerId}
          agent={agent}
          error={chiefState.tag === "error" ? chiefState.message : null}
          noHomeWorkspace={chiefState.tag === "no_home_workspace"}
          onRetry={handleRetry}
          onClose={close}
        />
      ) : null}
      {!showWindow && !isChiefOnScreen ? (
        <ChiefFab serverId={effectiveServerId} agentId={chiefAgentId} onPress={handleFabPress} />
      ) : null}
    </View>
  );
});

const containerStyle = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: "none" as const,
  zIndex: 900,
};
