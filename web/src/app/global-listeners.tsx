import { useCallback, useEffect, useRef, useState } from "react";
import { legacyFavoriteProfileMigration } from "@/agent-profiles/migration";
import { SessionProvider } from "@/contexts/session-context";
import { useToast } from "@/contexts/toast-context";
import { useFaviconStatus } from "@/hooks/use-favicon-status";
import { useStableEvent } from "@/hooks/use-stable-event";
import { SERVICE_WORKER_NOTIFICATION_CLICK_MESSAGE } from "@/push-notifications/internal/types";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
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
import { PairLinkModal } from "@/components/pair-link-modal";
import { router } from "~/app/navigation";
import { AppState } from "~/lib/app-state";
import { setAlertHandler } from "~/lib/alert";

// The headless pieces of the Expo app's root layout, one component each, same behaviour.

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

/**
 * A `#offer=` pairing link — clicked, or scanned from `byspace pair`'s QR — opens the pair form with
 * the link filled in. It must not import the host on its own: the offer never carries the daemon
 * password, so a password-protected host would land as an offline entry with no way to prove it.
 */
export function OfferLinkHost() {
  const [offerUrl, setOfferUrl] = useState<string | null>(null);
  const handleClose = useCallback(() => setOfferUrl(null), []);
  const handleSaved = useCallback(() => {
    setOfferUrl(null);
    router.replace(buildOpenProjectRoute());
  }, []);
  return (
    <>
      <OfferLinkListener onOfferLink={setOfferUrl} />
      {offerUrl ? (
        <PairLinkModal
          visible
          initialOfferUrl={offerUrl}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  );
}

function OfferLinkListener({ onOfferLink }: { onOfferLink: (url: string) => void }) {
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const handleUrl = (url: string) => {
      if (!url.includes("#offer=") || handledRef.current === url) return;
      handledRef.current = url;
      onOfferLink(url);
    };
    handleUrl(window.location.href);
    const onHashChange = () => handleUrl(window.location.href);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [onOfferLink]);

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

/** Shows showAlert notices (~/lib/alert) as error toasts. */
export function AlertToastBridge() {
  const toast = useToast();
  useEffect(() => {
    setAlertHandler((title, message) => {
      toast.show(
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{title}</span>
          {message ? <span>{message}</span> : null}
        </span>,
        { variant: "error", durationMs: 4000 },
      );
    });
    return () => setAlertHandler(null);
  }, [toast]);
  return null;
}
