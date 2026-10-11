import { memo, useCallback, useMemo, type ReactElement } from "react";
import { View } from "react-native";
import { usePathname } from "expo-router";
import { useHosts } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useRouter } from "expo-router";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { parseServerIdFromPathname } from "@/utils/host-routes";
import { useChiefStore } from "./chief-store";
import { useChiefAgent } from "./use-chief-agent";
import { ChiefFab } from "./chief-fab";
import { ChiefFloatingWindow } from "./chief-floating-window";

/**
 * Orchestrates the Chief FAB + floating window. Mounted once in the root
 * layout; renders on every screen.
 *
 * Route suppression: hidden when the current route shows the Chief agent
 * full-page (the floating copy would show the same session).
 */
export const ChiefPanelHost = memo(function ChiefPanelHost(): ReactElement | null {
  const pathname = usePathname();
  const router = useRouter();
  const hosts = useHosts();
  const isCompact = useIsCompactFormFactor();
  const isOpen = useChiefStore((state) => state.isOpen);
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

  const chiefState = useChiefAgent(currentServerId);
  const agent = chiefState.tag === "ready" ? chiefState.agent : null;
  // When the hook fell back to a different host, use that host's id for the
  // pane content so the embedded panel can resolve its daemon connection.
  const effectiveServerId = chiefState.tag === "ready" ? chiefState.serverId : currentServerId;

  const handleFabPress = useCallback(() => {
    if (isCompact) {
      // On mobile, navigate directly to the agent page instead of a floating window.
      if (agent && currentServerId) {
        router.push(`/h/${currentServerId}/agent/${agent.agentId}`);
      }
      return;
    }
    toggle();
  }, [isCompact, agent, currentServerId, router, toggle]);

  // Route suppression: don't show the floating window when the agent page is
  // already showing this Chief agent.
  const isOnChiefAgentPage = useMemo(() => {
    if (!agent || !currentServerId) return false;
    return pathname.includes(`/agent/${agent.agentId}`);
  }, [pathname, agent, currentServerId]);

  if (!currentServerId) return null;

  const showWindow = isOpen && !isCompact && !isOnChiefAgentPage;

  return (
    <View style={containerStyle} pointerEvents="box-none">
      {showWindow ? (
        <ChiefFloatingWindow serverId={effectiveServerId} agent={agent} onClose={close} />
      ) : null}
      {!showWindow ? (
        <ChiefFab
          serverId={currentServerId}
          agentId={agent?.agentId ?? null}
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
