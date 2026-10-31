import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { legacyFavoriteProfileMigration } from "@/agent-profiles/migration";
import { SessionProvider } from "@/contexts/session-context";
import { useFaviconStatus } from "@/hooks/use-favicon-status";
import { useStableEvent } from "@/hooks/use-stable-event";
import { SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE } from "@/push-notifications/internal/types";
import {
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHosts,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { flushDraftPersistStorage } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildNotificationRoute, resolveNotificationTarget } from "@/utils/notification-routing";
import {
  WEB_NOTIFICATION_CLICK_EVENT,
  type WebNotificationClickDetail,
} from "@/utils/os-notifications";
import { router } from "expo-router";

// The headless pieces of packages/app's root layout, one component each, same behaviour.

/** A notification click (page notification or Web Push via the service worker) opens its target. */
export function PushNotificationRouter() {
  const openNotification = useStableEvent((data: Record<string, unknown> | undefined) => {
    const { serverId, workspaceId, agentId } = resolveNotificationTarget(data);
    if (serverId && workspaceId && agentId) {
      navigateToAgent({ serverId, workspaceId, agentId, pin: true });
      return;
    }
    router.navigate(buildNotificationRoute(data));
  });

  useEffect(() => {
    const openFromWebClick = (event: Event) => {
      event.preventDefault();
      openNotification((event as CustomEvent<WebNotificationClickDetail>).detail?.data);
    };
    // Web Push notifications are clicked in the service worker, which hands the payload back here
    // because route building lives in the app bundle.
    const openFromServiceWorker = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (typeof message !== "object" || message === null) return;
      if (Reflect.get(message, "type") !== SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE) return;
      const data: unknown = Reflect.get(message, "data");
      openNotification(
        typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined,
      );
    };
    window.addEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick);
    navigator.serviceWorker?.addEventListener("message", openFromServiceWorker);
    return () => {
      window.removeEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick);
      navigator.serviceWorker?.removeEventListener("message", openFromServiceWorker);
    };
  }, [openNotification]);

  return null;
}

/** A `#offer=` pairing link imports the host, then opens the project picker. */
export function OfferLinkListener() {
  const { upsertConnectionFromOfferUrl } = useHostMutations();
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handleUrl = (url: string) => {
      if (!url.includes("#offer=") || handledRef.current === url) return;
      handledRef.current = url;
      void upsertConnectionFromOfferUrl(url)
        .then((profile) => {
          if (cancelled || !profile?.serverId) return;
          router.replace(buildOpenProjectRoute());
          return;
        })
        .catch((error: unknown) => {
          if (!cancelled) console.warn("[Linking] Failed to import pairing offer", error);
        });
    };
    handleUrl(window.location.href);
    const onHashChange = () => handleUrl(window.location.href);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [upsertConnectionFromOfferUrl]);

  return null;
}

function LegacyFavoriteProfileMigration({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  const isConnected = useHostRuntimeIsConnected(serverId);
  useEffect(() => {
    if (!client || !serverInfo || !isConnected) return;
    void legacyFavoriteProfileMigration.migrateHost(serverId, client).catch((error: unknown) => {
      console.warn("[AgentProfiles] Failed to migrate legacy favourites", error);
    });
  }, [client, isConnected, serverId, serverInfo]);
  return null;
}

function HostSession({ host }: { host: HostProfile }) {
  const client = useHostRuntimeClient(host.serverId);
  if (!client) return null;
  return (
    <SessionProvider key={host.serverId} serverId={host.serverId} client={client}>
      <LegacyFavoriteProfileMigration serverId={host.serverId} />
    </SessionProvider>
  );
}

/** One session per registered host keeps its agents and workspaces in the session store. */
export function HostSessionManager() {
  const hosts = useHosts();
  return hosts.map((host) => <HostSession key={host.serverId} host={host} />);
}

export function FaviconStatusSync() {
  useFaviconStatus();
  return null;
}

/** Drafts are persisted lazily; write them out when the page goes to the background. */
export function DraftFlushOnBackground() {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flushDraftPersistStorage();
    });
    return () => subscription.remove();
  }, []);
  return null;
}
