// Port of archive/expo-app:packages/app/src/components/welcome-screen.tsx: the first-run screen; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/welcome-screen.py; edit it directly.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "~/app/navigation";
import { Link2, ClipboardPaste, Settings, Terminal, type LucideIcon } from "lucide-react";
import type { HostProfile } from "@/types/host-connection";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { isBySpaceHostedAppBaseUrl } from "@bytetrue/protocol/release-channel";
import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { SetupGuideModal } from "@/components/setup-guide-modal";
import { Button } from "~/components/ui/button";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/utils/format-version";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { BySpaceLogo } from "@/components/icons/byspace-logo";

interface WelcomeAction {
  key: "direct-connection" | "paste-pairing-link" | "setup-guide";
  label: string;
  testID: string;
  primary: boolean;
  icon: LucideIcon;
  onPress: () => void;
}

function useAnyHostOnline(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
  );
}

export interface WelcomeScreenProps {
  onHostAdded?: (profile: HostProfile) => void;
}

export function WelcomeScreen({ onHostAdded }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const [isDirectOpen, setIsDirectOpen] = useState(false);
  const [isRemoteSshOpen, setIsRemoteSshOpen] = useState(false);
  const [isPasteLinkOpen, setIsPasteLinkOpen] = useState(false);
  const [isSetupGuideOpen, setIsSetupGuideOpen] = useState(false);
  const hosts = useHosts();
  const anyOnlineServerId = useAnyHostOnline(hosts.map((h) => h.serverId));

  useEffect(() => {
    if (!anyOnlineServerId) return;
    router.replace(buildOpenProjectRoute());
  }, [anyOnlineServerId, router]);

  const finishOnboarding = useCallback(() => {
    router.replace(buildOpenProjectRoute());
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    router.push("/settings");
  }, [router]);

  const handleOpenDirect = useCallback(() => setIsDirectOpen(true), []);
  const handleCloseDirect = useCallback(() => setIsDirectOpen(false), []);
  const handleCloseRemoteSsh = useCallback(() => setIsRemoteSshOpen(false), []);
  const handleOpenPasteLink = useCallback(() => setIsPasteLinkOpen(true), []);
  const handleClosePasteLink = useCallback(() => setIsPasteLinkOpen(false), []);
  const handleOpenSetupGuide = useCallback(() => setIsSetupGuideOpen(true), []);
  const handleCloseSetupGuide = useCallback(() => setIsSetupGuideOpen(false), []);

  const handleHostSaved = useCallback(
    ({ profile }: { profile: HostProfile; serverId: string }) => {
      onHostAdded?.(profile);
      finishOnboarding();
    },
    [onHostAdded, finishOnboarding],
  );

  // Web-only API: read inside component scope, never at module scope.
  const isHostedWeb =
    typeof window !== "undefined" && isBySpaceHostedAppBaseUrl(window.location?.origin ?? "");

  const setupGuideAction: WelcomeAction = {
    key: "setup-guide",
    label: t("pairing.connectionMethods.setupGuide.title"),
    testID: "welcome-setup-guide",
    primary: !isHostedWeb,
    icon: Terminal,
    onPress: handleOpenSetupGuide,
  };

  const actions: WelcomeAction[] = [
    ...(isHostedWeb ? [] : [setupGuideAction]),
    {
      key: "direct-connection",
      label: t("pairing.connectionMethods.direct.title"),
      testID: "welcome-direct-connection",
      primary: isHostedWeb,
      icon: Link2,
      onPress: handleOpenDirect,
    },
    {
      key: "paste-pairing-link",
      label: t("pairing.connectionMethods.pasteLink.title"),
      testID: "welcome-paste-pairing-link",
      primary: false,
      icon: ClipboardPaste,
      onPress: handleOpenPasteLink,
    },
    ...(isHostedWeb ? [setupGuideAction] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none]"
        data-testid="welcome-screen"
      >
        <div className="flex grow flex-col items-center p-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <div className="flex w-full grow flex-col items-center justify-center">
            <BySpaceLogo size={96} />
            <div className="mb-12 flex flex-col items-center gap-2">
              <span className="text-center text-sm leading-[normal] font-medium text-foreground">
                {t("onboarding.title")}
              </span>
              <span className="text-center text-sm leading-[normal] text-muted-foreground">
                {t("onboarding.subtitle")}
              </span>
            </div>

            <div className="flex w-full max-w-[420px] flex-col gap-3">
              {actions.map((action) => (
                <WelcomeActionButton key={action.key} action={action} />
              ))}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenSettings}
              className="mt-6 self-center"
              data-testid="welcome-open-settings"
            >
              <Settings data-icon="inline-start" />
              {t("onboarding.actions.settings")}
            </Button>
          </div>
          <span className="mt-6 text-center text-xs leading-[normal] text-muted-foreground">
            {appVersionText}
          </span>

          <AddHostModal
            visible={isDirectOpen}
            onClose={handleCloseDirect}
            onSaved={handleHostSaved}
          />

          <AddRemoteSshHostModal
            visible={isRemoteSshOpen}
            onClose={handleCloseRemoteSsh}
            onSaved={handleHostSaved}
          />

          <PairLinkModal
            visible={isPasteLinkOpen}
            onClose={handleClosePasteLink}
            onSaved={handleHostSaved}
          />

          <SetupGuideModal
            visible={isSetupGuideOpen}
            onClose={handleCloseSetupGuide}
            onSaved={handleHostSaved}
          />
        </div>
      </div>
    </div>
  );
}

interface WelcomeActionButtonProps {
  action: WelcomeAction;
}

function WelcomeActionButton({ action }: WelcomeActionButtonProps) {
  const Icon = action.icon;
  return (
    <Button
      variant={action.primary ? "default" : "outline"}
      size="lg"
      type="button"
      onClick={action.onPress}
      data-testid={action.testID}
    >
      <Icon size={18} />
      <span className="text-sm leading-[normal] font-medium">{action.label}</span>
    </Button>
  );
}
