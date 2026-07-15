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
import { View } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { CommandCenter } from "@/components/command-center";
import { WorktreeSetupCalloutSource } from "@/components/worktree-setup-callout-source";
import { DownloadToast } from "@/components/download-toast";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { LeftSidebar } from "@/components/left-sidebar";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";
import { CompactExplorerSidebarHost } from "@/components/compact-explorer-sidebar-host";
import { ProjectPickerModal } from "@/components/project-picker-modal";
import { ProviderSettingsHost } from "@/components/provider-settings-host";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { WorkspaceSetupDialog } from "@/components/workspace-setup-dialog";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { FloatingPanelPortalHost } from "@/components/ui/floating-panel-portal";
import { HostChooserModal } from "@/hosts/host-chooser";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { HorizontalScrollProvider } from "@/contexts/horizontal-scroll-context";
import { SessionProvider } from "@/contexts/session-context";
import { SidebarCalloutProvider } from "@/contexts/sidebar-callout-context";
import { ToastProvider } from "@/contexts/toast-context";
import { VoiceProvider } from "@/contexts/voice-context";
import {
  shouldRunStartupGiveUpTimer,
  type StartupBlocker,
} from "@/navigation/host-runtime-bootstrap";
import { registerWorkspaceRouteNavigationRef } from "@/navigation/workspace-route-navigation";
import { ThemedStack } from "@/navigation/themed-stack";
import { useActiveWorktreeNewAction } from "@/hooks/use-active-worktree-new-action";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";
import { useFaviconStatus } from "@/hooks/use-favicon-status";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShiftProvider } from "@/hooks/use-keyboard-shift-style";
import { useCompactWebViewportZoomLock } from "@/hooks/use-compact-web-viewport-zoom-lock";
import { useAppSettings } from "@/hooks/use-settings";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useOpenAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelsProvider } from "@/mobile-panels/provider";
import { I18nProvider } from "@/i18n/provider";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { polyfillCrypto } from "@/polyfills/crypto";
import { queryClient } from "@/data/query-client";
import {
  getHostRuntimeStore,
  useHostMutations,
  useHostRuntimeClient,
  useHosts,
} from "@/runtime/host-runtime";
import { applyAppearance } from "@/screens/settings/appearance/apply-appearance";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { THEME_TO_UNISTYLES, type ThemeName } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { toggleDesktopSidebarsWithCheckoutIntent } from "@/utils/desktop-sidebar-toggle";
import { buildOpenProjectRoute, parseServerIdFromPathname } from "@/utils/host-routes";
import { buildNotificationRoute, resolveNotificationTarget } from "@/utils/notification-routing";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  WEB_NOTIFICATION_CLICK_EVENT,
  type WebNotificationClickDetail,
} from "@/utils/os-notifications";

polyfillCrypto();

export interface HostRuntimeBootstrapState {
  splashError: string | null;
  retry: () => void;
  hasGivenUpWaitingForHost: boolean;
  storeReady: boolean;
  startupBlocker: StartupBlocker;
}

const HostRuntimeBootstrapContext = createContext<HostRuntimeBootstrapState>({
  splashError: null,
  retry: () => {},
  hasGivenUpWaitingForHost: false,
  storeReady: false,
  startupBlocker: { kind: "none" },
});

function PushNotificationRouter() {
  const router = useRouter();
  const openNotification = useStableEvent((data: Record<string, unknown> | undefined) => {
    const target = resolveNotificationTarget(data);
    if (target.serverId && target.agentId) {
      navigateToAgent({ serverId: target.serverId, agentId: target.agentId, pin: true });
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
      {null}
    </SessionProvider>
  );
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
const NO_STARTUP_BLOCKER: StartupBlocker = { kind: "none" };

function HostRuntimeBootstrapProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    getHostRuntimeStore().boot();
  }, []);

  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const [hasGivenUpWaitingForHost, setHasGivenUpWaitingForHost] = useState(false);
  const shouldRunGiveUpTimer = shouldRunStartupGiveUpTimer({
    startupBlocker: NO_STARTUP_BLOCKER,
    anyOnlineHostServerId,
    hasGivenUpWaitingForHost,
  });

  useEffect(() => {
    if (!shouldRunGiveUpTimer) return;
    const handle = setTimeout(() => setHasGivenUpWaitingForHost(true), STARTUP_GIVE_UP_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [shouldRunGiveUpTimer]);

  const retry = useCallback(() => {
    void getHostRuntimeStore().ensureConnectedAll();
  }, []);
  const state = useMemo<HostRuntimeBootstrapState>(
    () => ({
      splashError: null,
      retry,
      hasGivenUpWaitingForHost,
      storeReady: true,
      startupBlocker: NO_STARTUP_BLOCKER,
    }),
    [hasGivenUpWaitingForHost, retry],
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

const THEME_CYCLE_ORDER: ThemeName[] = ["dark", "zinc", "midnight", "claude", "ghostty", "light"];

function AppContainer({ children, chromeEnabled: chromeEnabledOverride }: AppContainerProps) {
  const daemons = useHosts();
  const { settings, updateSettings } = useAppSettings();
  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);
  const closeDesktopAgentList = usePanelStore((state) => state.closeDesktopAgentList);
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const toggleFocusMode = usePanelStore((state) => state.toggleFocusMode);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);

  const cycleTheme = useCallback(() => {
    const currentIndex = THEME_CYCLE_ORDER.indexOf(settings.theme as ThemeName);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE_ORDER.length;
    void updateSettings({ theme: THEME_CYCLE_ORDER[nextIndex] });
  }, [settings.theme, updateSettings]);

  const isCompactLayout = useIsCompactFormFactor();
  useCompactWebViewportZoomLock(isCompactLayout);
  const pathname = usePathname();
  const chromeEnabled = chromeEnabledOverride ?? daemons.length > 0;
  const toggleAgentList = isCompactLayout ? toggleMobileAgentList : toggleDesktopAgentList;
  const toggleDesktopSidebars = useCallback(() => {
    const { desktop } = usePanelStore.getState();
    toggleDesktopSidebarsWithCheckoutIntent({
      isAgentListOpen: desktop.agentListOpen,
      isFileExplorerOpen: desktop.fileExplorerOpen,
      openAgentList: openDesktopAgentList,
      closeAgentList: closeDesktopAgentList,
      closeFileExplorer: closeDesktopFileExplorer,
      toggleFocusedFileExplorer: () =>
        keyboardActionDispatcher.dispatch({
          id: "sidebar.toggle.right",
          scope: "sidebar",
        }),
    });
  }, [closeDesktopAgentList, closeDesktopFileExplorer, openDesktopAgentList]);
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
    toggleFocusMode,
    cycleTheme,
  });

  useActiveWorktreeNewAction();
  useGlobalNewWorkspaceAction();

  const sidebarChrome = (
    <SidebarChrome
      showSidebar={chromeEnabled && (isCompactLayout || !isFocusModeEnabled)}
      keyboardShortcutsEnabled={keyboardShortcutsEnabled}
    />
  );

  const workspaceChrome = (
    <View style={rowStyle}>
      {!isCompactLayout ? sidebarChrome : null}
      {isCompactLayout && chromeEnabled ? (
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
      <CommandCenter />
      <HostChooserModal />
      <ProjectPickerModal />
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

  return content;
}

function SidebarChrome({
  showSidebar,
  keyboardShortcutsEnabled,
}: {
  showSidebar: boolean;
  keyboardShortcutsEnabled: boolean;
}) {
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  return (
    <SidebarModelProvider active={showSidebar && isOpen}>
      {showSidebar ? <LeftSidebar /> : null}
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
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const { upsertConnectionFromOfferUrl } = useHostMutations();

  // Apply theme setting on mount and when it changes
  useEffect(() => {
    if (settingsLoading) return;
    if (settings.theme === "auto") {
      UnistylesRuntime.setAdaptiveThemes(true);
    } else {
      UnistylesRuntime.setAdaptiveThemes(false);
      UnistylesRuntime.setTheme(THEME_TO_UNISTYLES[settings.theme]);
    }
  }, [settingsLoading, settings.theme]);

  // Apply font / size / syntax appearance settings on mount and when they change.
  // Sibling to the theme effect above; order is irrelevant because both patch all
  // six registered theme keys, so the active key is always current.
  useEffect(() => {
    if (settingsLoading) return;
    applyAppearance({
      uiFontFamily: settings.uiFontFamily,
      monoFontFamily: settings.monoFontFamily,
      uiFontSize: settings.uiFontSize,
      codeFontSize: settings.codeFontSize,
      syntaxTheme: settings.syntaxTheme,
    });
  }, [
    settingsLoading,
    settings.uiFontFamily,
    settings.monoFontFamily,
    settings.uiFontSize,
    settings.codeFontSize,
    settings.syntaxTheme,
  ]);

  return (
    <VoiceProvider>
      <OfferLinkListener upsertDaemonFromOfferUrl={upsertConnectionFromOfferUrl} />
      <HostSessionManager />
      <FaviconStatusSync />
      {children}
    </VoiceProvider>
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
    <SafeAreaProvider>
      <KeyboardProvider>
        <KeyboardShiftProvider>
          <PortalProvider>
            <BottomSheetModalProvider>{children}</BottomSheetModalProvider>
          </PortalProvider>
        </KeyboardShiftProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootAppTree() {
  return (
    <GestureHandlerRootView style={flexStyle}>
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
  return (
    <QueryProvider>
      <I18nProvider>
        <RootErrorBoundary>
          <RootAppTree />
        </RootErrorBoundary>
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
