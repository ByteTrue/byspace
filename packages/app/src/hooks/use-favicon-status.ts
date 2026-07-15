import { useEffect, useState } from "react";
import { useAggregatedAgents } from "./use-aggregated-agents";

type FaviconStatus = "none" | "running" | "attention";
type ColorScheme = "dark" | "light";

/* eslint-disable @typescript-eslint/no-require-imports */
const FAVICON_IMAGES: Record<ColorScheme, Record<FaviconStatus, { uri: string } | number>> = {
  dark: {
    none: require("../../assets/images/favicon-dark.png"),
    running: require("../../assets/images/favicon-dark-running.png"),
    attention: require("../../assets/images/favicon-dark-attention.png"),
  },
  light: {
    none: require("../../assets/images/favicon-light.png"),
    running: require("../../assets/images/favicon-light-running.png"),
    attention: require("../../assets/images/favicon-light-attention.png"),
  },
};
/* eslint-enable @typescript-eslint/no-require-imports */

function deriveFaviconStatus(
  agents: ReturnType<typeof useAggregatedAgents>["agents"],
): FaviconStatus {
  if (agents.some((agent) => agent.status === "running")) return "running";
  if (agents.some((agent) => agent.requiresAttention || (agent.pendingPermissionCount ?? 0) > 0)) {
    return "attention";
  }
  return "none";
}

function getFaviconUri(status: FaviconStatus, colorScheme: ColorScheme): string {
  const image = FAVICON_IMAGES[colorScheme][status];
  if (typeof image === "object" && "uri" in image) return image.uri;
  const suffix = status === "none" ? "" : `-${status}`;
  return `/assets/images/favicon-${colorScheme}${suffix}.png`;
}

function updateFavicon(status: FaviconStatus, colorScheme: ColorScheme): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
  }
  const href = getFaviconUri(status, colorScheme);
  if (link.href !== href) link.href = href;
}

function getSystemColorScheme(): ColorScheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useFaviconStatus(): void {
  const { agents } = useAggregatedAgents();
  const [colorScheme, setColorScheme] = useState<ColorScheme>(getSystemColorScheme);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) =>
      setColorScheme(event.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    updateFavicon(deriveFaviconStatus(agents), colorScheme);
  }, [agents, colorScheme]);
}
