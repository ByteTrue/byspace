import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { View } from "react-native";
import { usePathname, useGlobalSearchParams } from "expo-router";
import { useHosts } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useRouter } from "expo-router";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { buildHostAgentDetailRoute, parseServerIdFromPathname } from "@/utils/host-routes";
import { isShowingChiefAgent } from "./chief-route";
import { useSessionStore } from "@/stores/session-store";
import { useHostAgentRoleNames } from "@/agent-controls/use-agent-roles";
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
 * Route suppression: hidden when the current route shows the Chief agent
 * full-page (the floating copy would show the same session).
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
  // A workspace route can be opened onto an agent (?open=agent:<id>), which is
  // how the compact FAB navigates. The pathname alone cannot tell that apart
  // from the workspace root.
  const openIntentParam = useGlobalSearchParams<{ open?: string }>().open;
  const earliestOnlineServerId = getHostRuntimeStore().getEarliestOnlineHostServerId();
  const currentServerId = useMemo(() => {
    if (pathServerId && hosts.some((host) => host.serverId === pathServerId)) {
      return pathServerId;
    }
    return earliestOnlineServerId ?? hosts[0]?.serverId ?? pathServerId;
  }, [pathServerId, earliestOnlineServerId, hosts]);
  // The workspace route consumes ?open=agent:<id> and strips it from the URL, so
  // the intent alone is not enough to keep the button off a compact screen: the
  // agent the workspace screen ended up focusing is the durable signal.
  const focusedAgentId = useSessionStore(
    (state) => (currentServerId ? state.sessions[currentServerId]?.focusedAgentId : null) ?? null,
  );

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

  // Route suppression: don't show the floating window (or its button, on
  // compact) when the screen already shows this Chief agent full-page.
  const isOnChiefAgentPage = useMemo(() => {
    if (!agent || !currentServerId) return false;
    return isShowingChiefAgent({
      pathname,
      openIntentParam,
      focusedAgentId,
      agentId: agent.agentId,
    });
  }, [pathname, openIntentParam, focusedAgentId, agent, currentServerId]);

  // Feature gate: a daemon that offers no built-in roles has no Chief to open,
  // so hide the entry point instead of showing a dead FAB. The catalog, not the
  // legacy boolean, is what says which roles exist.
  const roleNames = useHostAgentRoleNames(currentServerId);

  if (!currentServerId || isE2E || !roleNames.includes("chief")) return null;

  const showWindow = isOpen && !isCompact && !isOnChiefAgentPage;

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
      {/* Kept mounted while the window is open: the button is the window's
          toggle, and a control that walks away from under the pointer cannot be
          clicked twice. It is hidden only where it would duplicate a full page. */}
      {!isOnChiefAgentPage ? (
        <ChiefFab
          serverId={effectiveServerId}
          agentId={agent?.agentId ?? null}
          isOpen={showWindow}
          onPress={handleFabPress}
        />
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
