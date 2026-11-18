import { useEffect, useRef, useState } from "react";
import { useAggregatedAgents } from "./use-aggregated-agents";
import { useWorkspaceStatusesForBadges } from "@/stores/session-store-hooks";
import { deriveMacDockBadgeCountFromWorkspaceStatuses } from "@/utils/desktop-badge-state";
import faviconDark from "@/assets/images/favicon-dark.png";
import faviconDarkAttention from "@/assets/images/favicon-dark-attention.png";
import faviconDarkRunning from "@/assets/images/favicon-dark-running.png";
import faviconLight from "@/assets/images/favicon-light.png";
import faviconLightAttention from "@/assets/images/favicon-light-attention.png";
import faviconLightRunning from "@/assets/images/favicon-light-running.png";

type FaviconStatus = "none" | "running" | "attention";
type ColorScheme = "dark" | "light";

const FAVICON_IMAGES: Record<ColorScheme, Record<FaviconStatus, string>> = {
  dark: { none: faviconDark, running: faviconDarkRunning, attention: faviconDarkAttention },
  light: { none: faviconLight, running: faviconLightRunning, attention: faviconLightAttention },
};

function deriveFaviconStatus(
  agents: ReturnType<typeof useAggregatedAgents>["agents"],
): FaviconStatus {
  const hasRunning = agents.some((agent) => agent.status === "running");
  if (hasRunning) {
    return "running";
  }
  const hasAttention = agents.some((agent) => agent.requiresAttention);
  const hasNeedsInput = agents.some((agent) => (agent.pendingPermissionCount ?? 0) > 0);
  if (hasAttention || hasNeedsInput) {
    return "attention";
  }
  return "none";
}

function getFaviconUri(status: FaviconStatus, colorScheme: ColorScheme): string {
  return FAVICON_IMAGES[colorScheme][status];
}

function getOrCreateFaviconLink(): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
  }
  return link;
}

function updateFavicon(status: FaviconStatus, colorScheme: ColorScheme) {
  const link = getOrCreateFaviconLink();
  if (!link) return;

  const newHref = getFaviconUri(status, colorScheme);
  if (link.href !== newHref) {
    link.href = newHref;
  }
}

function getSystemColorScheme(): ColorScheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useFaviconStatus() {
  const { agents } = useAggregatedAgents({ demand: true });
  const workspaceStatuses = useWorkspaceStatusesForBadges();
  const [colorScheme, setColorScheme] = useState<ColorScheme>(getSystemColorScheme);
  const lastDockBadgeCountRef = useRef<number | undefined>(undefined);

  // Listen for system color scheme changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setColorScheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Update favicon when agents or color scheme changes
  useEffect(() => {
    const status = deriveFaviconStatus(agents);
    updateFavicon(status, colorScheme);

    const dockBadgeCount = deriveMacDockBadgeCountFromWorkspaceStatuses(workspaceStatuses);
    if (dockBadgeCount !== lastDockBadgeCountRef.current) {
      lastDockBadgeCountRef.current = dockBadgeCount;
    }
  }, [agents, colorScheme, workspaceStatuses]);
}
