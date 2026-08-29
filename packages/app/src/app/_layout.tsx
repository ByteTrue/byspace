import "@/styles/unistyles";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalProvider } from "@gorhom/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Stack, useNavigationContainerRef, usePathname, useRouter } from "expo-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, useWindowDimensions, View } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { AppearanceProvider } from "@/appearance/provider";
import { CommandCenter } from "@/command-center/command-center";
import { CommandCenterRootActions } from "@/command-center/root-registration";
import { CommandCenterProvider } from "@/command-center/provider";
import { CommandCenterWorkspaceActions } from "@/command-center/workspace-registration";
import { PluginCommandCenterActions } from "@/plugins/command-center/registration";
import { AddProjectFlowHost } from "@/components/add-project-flow-host";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import { WorktreeSetupCalloutSource } from "@/components/worktree-setup-callout-source";
import { DownloadToast } from "@/components/download-toast";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { LeftSidebar } from "@/components/left-sidebar";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";
import { CompactExplorerSidebarHost } from "@/components/compact-explorer-sidebar-host";
import { ProviderSettingsHost } from "@/components/provider-settings-host";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { WorkspaceSetupDialog } from "@/components/workspace-setup-dialog";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { WorkspacePinShortcutHandler } from "@/components/workspace-pin-shortcut-handler";
import { FloatingPanelPortalHost } from "@/components/ui/floating-panel-portal";
import { HostChooserModal } from "@/hosts/host-chooser";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  canDesktopAppSidebarShare,
  resolveDesktopAppContentMinimum,
  resolveDesktopSidebarVisibility,
} from "@/components/desktop-sidebar-layout";
import { isWeb } from "@/constants/platform";
import { HorizontalScrollProvider } from "@/contexts/horizontal-scroll-context";
import { SessionProvider } from "@/contexts/session-context";
import { SidebarCalloutProvider } from "@/contexts/sidebar-callout-context";
import { ToastProvider } from "@/contexts/toast-context";
import { AudioProvider } from "@/contexts/audio-context";
import { shouldRunStartupGiveUpTimer } from "@/navigation/host-runtime-bootstrap";
import { registerWorkspaceRouteNavigationRef } from "@/navigation/workspace-route-navigation";
import { ThemedStack } from "@/navigation/themed-stack";
import { legacyFavoriteProfileMigration } from "@/agent-profiles/migration";
import { useActiveWorktreeNewAction } from "@/hooks/use-active-worktree-new-action";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";
import { useLatchedBoolean } from "@/hooks/use-latched-boolean";
import { useFaviconStatus } from "@/hooks/use-favicon-status";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useCompactWebViewportZoomLock } from "@/hooks/use-compact-web-viewport-zoom-lock";
import { useAppSettings } from "@/hooks/use-settings";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useOpenAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelsProvider } from "@/mobile-panels/provider";
import { I18nProvider } from "@/i18n/provider";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import { polyfillCrypto } from "@/polyfills/crypto";
import { queryClient } from "@/data/query-client";
import {
  getHostRuntimeStore,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHosts,
} from "@/runtime/host-runtime";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { flushDraftPersistStorage } from "@/stores/draft-store";
import { getNextThemePreference } from "@/styles/theme";
import { useSessionStore } from "@/stores/session-store";
import { installWebScrollbarStyles } from "@/styles/install-web-scrollbar-styles";
import type { HostProfile } from "@/types/host-connection";
import {
  buildOpenProjectRoute,
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
} from "@/utils/host-routes";
import { buildNotificationRoute, resolveNotificationTarget } from "@/utils/notification-routing";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { PluginCatalogSync } from "@/plugins";
import {
  WEB_NOTIFICATION_CLICK_EVENT,
  type WebNotificationClickDetail,
} from "@/utils/os-notifications";

polyfillCrypto();

export interface HostRuntimeBootstrapState {
  hasGivenUpWaitingForHost: boolean;
  storeReady: boolean;
}

const HostRuntimeBootstrapContext = createContext<HostRuntimeBootstrapState>({
  hasGivenUpWaitingForHost: false,
  storeReady: false,
});

function PushNotificationRouter() {
  const router = useRouter();
  const openNotification = useStableEvent((data: Record<string, unknown> | undefined) => {
    const target = resolveNotificationTarget(data);
    if (target.serverId && target.workspaceId && target.agentId) {
      navigateToAgent({
        serverId: target.serverId,
        workspaceId: target.workspaceId,
        agentId: target.agentId,
        pin: true,
      });
      return;
    }
    router.navigate(buildNotificationRoute(data));
  });

  useEffect(() => {
    const openFromWebClick = (event: Event) => {
      const customEvent = event as CustomEvent<WebNotificationClickDetail>;
      event.preventDefault();
      openNotification(customEvent.detail?.data);
    };
    window.addEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick as EventListener);
    return () => {
      window.removeEventListener(WEB_NOTIFICATION_CLICK_EVENT, openFromWebClick as EventListener);
    };
  }, [openNotification]);

  return null;
}

function ManagedDaemonSession({ daemon }: { daemon: HostProfile }) {
  const client = useHostRuntimeClient(daemon.serverId);

  if (!client) {
    return null;
  }

  return (
    <SessionProvider key={daemon.serverId} serverId={daemon.serverId} client={client}>
      <LegacyFavoriteProfileMigrationBootstrap serverId={daemon.serverId} client={client} />
      <PluginCatalogSync serverId={daemon.serverId} client={client} />
    </SessionProvider>
  );
}

function LegacyFavoriteProfileMigrationBootstrap({
  serverId,
  client,
}: {
  serverId: string;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
}) {
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  const isConnected = useHostRuntimeIsConnected(serverId);

  useEffect(() => {
    if (!serverInfo || !isConnected) {
      return;
    }
    void legacyFavoriteProfileMigration.migrateHost(serverId, client).catch((error) => {
      console.warn("[AgentProfiles] Failed to migrate legacy favourites", error);
    });
  }, [client, isConnected, serverId, serverInfo]);

  return null;
}

function HostSessionManager() {
  const hosts = useHosts();

  if (hosts.length === 0) {
    return null;
  }

  return (
    <>
      {hosts.map((daemon) => (
        <ManagedDaemonSession key={daemon.serverId} daemon={daemon} />
      ))}
    </>
  );
}

export function useEarliestOnlineHostServerId(): string | null {
  const store = getHostRuntimeStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeAll = store.subscribeAll(listener);
      const unsubscribeHostList = store.subscribeHostList(listener);
      return () => {
        unsubscribeAll();
        unsubscribeHostList();
      };
    },
    [store],
  );
  return useSyncExternalStore(
    subscribe,
    () => store.getEarliestOnlineHostServerId(),
    () => store.getEarliestOnlineHostServerId(),
  );
}

const STARTUP_GIVE_UP_TIMEOUT_MS = 5_000;

function HostRuntimeBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    getHostRuntimeStore().boot();
  }, []);

  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const [hasGivenUpWaitingForHost, setHasGivenUpWaitingForHost] = useState(false);
  const shouldRunGiveUpTimer = shouldRunStartupGiveUpTimer({
    anyOnlineHostServerId,
    hasGivenUpWaitingForHost,
  });

  useEffect(() => {
    if (!shouldRunGiveUpTimer) return;
    const handle = setTimeout(() => setHasGivenUpWaitingForHost(true), STARTUP_GIVE_UP_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [shouldRunGiveUpTimer]);

  const state = useMemo<HostRuntimeBootstrapState>(
    () => ({
      hasGivenUpWaitingForHost,
      storeReady: true,
    }),
    [hasGivenUpWaitingForHost],
  );

  return (
    <HostRuntimeBootstrapContext.Provider value={state}>
      {children}
    </HostRuntimeBootstrapContext.Provider>
  );
}

export function useStoreReady(): boolean {
  return useContext(HostRuntimeBootstrapContext).storeReady;
}

export function useHostRuntimeBootstrapState(): HostRuntimeBootstrapState {
  return useContext(HostRuntimeBootstrapContext);
}

function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const rowStyle = { flex: 1, flexDirection: "row" } as const;
const flexStyle = { flex: 1 } as const;
const MOBILE_WEB_GESTURE_TOUCH_ACTION = isWeb ? "auto" : "pan-y";

interface AppContainerProps {
  children: ReactNode;
  chromeEnabled?: boolean;
}

function AppContainer({ children, chromeEnabled: chromeEnabledOverride }: AppContainerProps) {
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const daemons = useHosts();
  const { settings, updateSettings } = useAppSettings();
  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const isDesktopAgentListOpen = usePanelStore((state) => state.desktop.agentListOpen);
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();

  const cycleTheme = useCallback(() => {
    void updateSettings({ theme: getNextThemePreference(settings.theme) });
  }, [settings.theme, updateSettings]);

  const isCompactLayout = useIsCompactFormFactor();
  useCompactWebViewportZoomLock(isCompactLayout);
  const pathname = usePathname();
  const isWorkspaceRoute = parseHostWorkspaceRouteFromPathname(pathname) !== null;
  const isWorkspaceFocusModeEnabled = isWorkspaceRoute && isFocusModeEnabled;
  const chromeEnabled = chromeEnabledOverride ?? daemons.length > 0;
  const hasMountedDesktopSidebar = useLatchedBoolean(chromeEnabled);
  const toggleAgentList = isCompactLayout ? toggleMobileAgentList : toggleDesktopAgentList;
  const toggleDesktopSidebars = useCallback(() => {
    // The focused workspace owns its layout key, its checkout, and therefore the
    // only correct answer to "is the explorer open". Let it decide when there is
    // one: the pathname alone cannot identify the active workspace, because
    // desktop cold-starts at "/" and restores the workspace from route params.
    if (keyboardActionDispatcher.dispatch({ id: "sidebar.toggle.both", scope: "sidebar" })) {
      return;
    }
    // Off a workspace route there is no explorer — only the agent list.
    toggleAgentList();
  }, [keyboardActionDispatcher, toggleAgentList]);
  // TODO: stop matching pathname here as a branch. `chromeEnabled` should not
  // conflate workspace/project-specific chrome (sidebar, mobile gesture) with
  // global concerns like keyboard shortcuts. Split those out so settings (and
  // other non-workspace routes) don't need a special-case to keep shortcuts alive.
  const keyboardShortcutsEnabled = chromeEnabled || pathname.startsWith("/settings");

  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled,
    isMobile: isCompactLayout,
    toggleAgentList,
    toggleBothSidebars: toggleDesktopSidebars,
    cycleTheme,
  });

  useActiveWorktreeNewAction();
  useGlobalNewWorkspaceAction();

  const appContentMinimumWidth = resolveDesktopAppContentMinimum({
    isSettingsRoute: pathname.includes("/settings"),
  });
  const desktopSidebarMounted = hasMountedDesktopSidebar && !isWorkspaceFocusModeEnabled;
  const desktopSidebarVisible = resolveDesktopSidebarVisibility({
    chromeEnabled,
    isCompactLayout,
    isMounted: desktopSidebarMounted,
    isOpen: isDesktopAgentListOpen,
    canShare: canDesktopAppSidebarShare({
      contentMinimumWidth: appContentMinimumWidth,
      requestedSidebarWidth: sidebarWidth,
      viewportWidth,
    }),
  });
  const sidebarChrome = (
    <SidebarChrome
      mounted={isCompactLayout ? chromeEnabled : desktopSidebarMounted}
      visible={isCompactLayout ? chromeEnabled : desktopSidebarVisible}
      keyboardShortcutsEnabled={keyboardShortcutsEnabled}
    />
  );
  const workspaceChrome = (
    <View style={rowStyle}>
      {!isCompactLayout ? sidebarChrome : null}
      {isCompactLayout ? (
        <CompactExplorerSidebarHost enabled={chromeEnabled}>
          <View style={flexStyle}>{children}</View>
        </CompactExplorerSidebarHost>
      ) : (
        <View style={flexStyle}>{children}</View>
      )}
    </View>
  );

  const surface = (
    <View style={layoutStyles.surfaceFill}>
      {workspaceChrome}
      <FloatingPanelPortalHost />
      {isCompactLayout ? sidebarChrome : null}
      <DownloadToast />
      <WorktreeSetupCalloutSource />
      <CommandCenterRootActions />
      <CommandCenterWorkspaceActions />
      <PluginCommandCenterActions />
      <CommandCenter />
      <AddProjectFlowHost />
      <HostChooserModal />
      <ProviderSettingsHost />
      <WorkspaceSetupDialog />
      <KeyboardShortcutsDialog />
    </View>
  );

  const content = isCompactLayout ? (
    <MobileGestureWrapper chromeEnabled={chromeEnabled}>{surface}</MobileGestureWrapper>
  ) : (
    surface
  );

  return <CommandCenterProvider>{content}</CommandCenterProvider>;
}

function SidebarChrome({
  mounted,
  visible,
  keyboardShortcutsEnabled,
}: {
  mounted: boolean;
  visible: boolean;
  keyboardShortcutsEnabled: boolean;
}) {
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const active = visible && isOpen;
  return (
    <SidebarModelProvider active={active}>
      {mounted ? <LeftSidebar active={active} /> : null}
      <WorkspaceShortcutTargetsSubscriber enabled={keyboardShortcutsEnabled} />
    </SidebarModelProvider>
  );
}

function MobileGestureWrapper({
  children,
  chromeEnabled,
}: {
  children: ReactNode;
  chromeEnabled: boolean;
}) {
  const openGesture = useOpenAgentListGesture(chromeEnabled);

  return (
    <GestureDetector gesture={openGesture} touchAction={MOBILE_WEB_GESTURE_TOUCH_ACTION}>
      <View collapsable={false} style={layoutStyles.surfaceFill}>
        {children}
      </View>
    </GestureDetector>
  );
}

function ProvidersWrapper({ children }: { children: ReactNode }) {
  const { upsertConnectionFromOfferUrl } = useHostMutations();

  return (
    <AppearanceProvider>
      <AudioProvider>
        <OfferLinkListener upsertDaemonFromOfferUrl={upsertConnectionFromOfferUrl} />
        <HostSessionManager />
        <FaviconStatusSync />
        <AppearanceStyleBoundary>{children}</AppearanceStyleBoundary>
      </AudioProvider>
    </AppearanceProvider>
  );
}

function OfferLinkListener({
  upsertDaemonFromOfferUrl,
}: {
  upsertDaemonFromOfferUrl: (offerUrlOrFragment: string) => Promise<unknown>;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const handleUrl = (url: string | null) => {
      if (!url) return;
      if (!url.includes("#offer=")) return;
      void upsertDaemonFromOfferUrl(url)
        .then((profile) => {
          if (cancelled) return;
          const serverId = (profile as { serverId?: unknown } | null)?.serverId;
          if (typeof serverId !== "string" || !serverId) return;
          router.replace(buildOpenProjectRoute());
          return;
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[Linking] Failed to import pairing offer", error);
        });
    };

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router, upsertDaemonFromOfferUrl]);

  return null;
}

function AppWithSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hosts = useHosts();
  const storeReady = useStoreReady();
  const routeServerId = useMemo(() => parseServerIdFromPathname(pathname), [pathname]);
  const routeHasKnownHost =
    routeServerId !== null && hosts.some((host) => host.serverId === routeServerId);
  const shouldShowAppChrome =
    storeReady &&
    (pathname === "/open-project" ||
      pathname === "/new" ||
      pathname === "/sessions" ||
      pathname === "/schedules" ||
      routeHasKnownHost);

  return <AppContainer chromeEnabled={shouldShowAppChrome}>{children}</AppContainer>;
}

function FaviconStatusSync() {
  useFaviconStatus();
  return null;
}

const ROOT_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

function RootStack() {
  const storeReady = useStoreReady();
  return (
    <ThemedStack screenOptions={ROOT_STACK_SCREEN_OPTIONS}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={storeReady}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/[section]" />
        <Stack.Screen name="settings/projects/index" />
        <Stack.Screen name="settings/projects/[projectKey]" />
        <Stack.Screen name="new" />
        <Stack.Screen name="open-project" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="schedules" />
      </Stack.Protected>
      <Stack.Screen name="h/[serverId]" />
      <Stack.Screen name="settings/hosts/[serverId]/index" />
      <Stack.Screen name="settings/hosts/[serverId]/[hostSection]" />
    </ThemedStack>
  );
}

function WorkspaceRouteNavigationBridge() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    return registerWorkspaceRouteNavigationRef(navigationRef);
  }, [navigationRef]);

  return null;
}

function AppShell() {
  return (
    <MobilePanelsProvider>
      <HorizontalScrollProvider>
        <AppWithSidebar>
          <WorkspaceRouteNavigationBridge />
          <WorkspacePinShortcutHandler />
          <RootStack />
        </AppWithSidebar>
      </HorizontalScrollProvider>
    </MobilePanelsProvider>
  );
}

function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <HostRuntimeBootstrapProvider>
      <PushNotificationRouter />
      <SidebarCalloutProvider>
        <ToastProvider>
          <ProvidersWrapper>{children}</ProvidersWrapper>
        </ToastProvider>
      </SidebarCalloutProvider>
    </HostRuntimeBootstrapProvider>
  );
}

// PortalProvider must stay inside normal app-wide context providers.
// `@gorhom/portal` renders portaled children at the host's location in the
// tree, so any context a portaled sheet might consume (QueryClient, theme,
// auth, settings, ...) must wrap PortalProvider, not be wrapped by it.
// BottomSheetModalProvider is the exception: Gorhom modals consume portal
// context and need one shared provider for sibling sheets to stack.
function RootProviders({ children }: { children: ReactNode }) {
  return (
    <KeyboardActionDispatcherProvider>
      <PortalProvider>
        <BottomSheetModalProvider>{children}</BottomSheetModalProvider>
      </PortalProvider>
    </KeyboardActionDispatcherProvider>
  );
}

function recordUserActivity(): void {
  getHostRuntimeStore().recordUserActivity();
}

function RootAppTree() {
  return (
    <GestureHandlerRootView
      style={flexStyle}
      onTouchStart={recordUserActivity}
      onTouchEnd={recordUserActivity}
      onTouchCancel={recordUserActivity}
    >
      <View style={layoutStyles.surfaceFill}>
        <RootProviders>
          <RuntimeProviders>
            <AppShell />
          </RuntimeProviders>
        </RootProviders>
      </View>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  useEffect(() => installWebScrollbarStyles(), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        void flushDraftPersistStorage();
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <QueryProvider>
      <I18nProvider>
        <SafeAreaProvider>
          <RootErrorBoundary>
            <RootAppTree />
          </RootErrorBoundary>
        </SafeAreaProvider>
      </I18nProvider>
    </QueryProvider>
  );
}

const layoutStyles = StyleSheet.create((theme) => ({
  surfaceFill: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
