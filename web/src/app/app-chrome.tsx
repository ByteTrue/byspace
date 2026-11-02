import { CompactExplorerSidebarHost } from "@/components/compact-explorer-sidebar-host";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router";
import { useStoreReady } from "@/app/_layout";
import { CommandCenter } from "@/command-center/command-center";
import { CommandCenterProvider } from "@/command-center/provider";
import { CommandCenterRootActions } from "@/command-center/root-registration";
import { CommandCenterWorkspaceActions } from "@/command-center/workspace-registration";
import { HostChooserModal } from "@/hosts/host-chooser";
import {
  canDesktopAppSidebarShare,
  resolveDesktopAppContentMinimum,
  resolveDesktopSidebarVisibility,
  resolveDesktopSidebarWidth,
} from "@/components/desktop-sidebar-layout";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";
import { WorkspacePinShortcutHandler } from "@/components/workspace-pin-shortcut-handler";
import { WorkspaceRenameHost } from "@/components/workspace-rename-host";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { WorktreeSetupCalloutSource } from "@/components/worktree-setup-callout-source";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DesktopSidebarVisibilityProvider } from "@/contexts/desktop-sidebar-visibility-context";
import { useActiveWorktreeNewAction } from "@/hooks/use-active-worktree-new-action";
import { useCompactWebViewportZoomLock } from "@/hooks/use-compact-web-viewport-zoom-lock";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useAppSettings } from "@/hooks/use-settings";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { MobilePanelsProvider, useMobilePanelOpenGesture } from "@/mobile-panels/provider";
import { useHosts } from "@/runtime/host-runtime";
import { usePanelStore } from "@/stores/panel-store";
import { getNextThemePreference } from "@/styles/theme";
import {
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
} from "@/utils/host-routes";
import { useWindowDimensions } from "react-native";
import { AppSidebar } from "~/app/app-sidebar";
import { SidebarResizeHandle } from "~/app/sidebar-resize-handle";
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from "~/components/ui/sidebar";

// Routes that stand alone without app chrome, as in packages/app's root layout.
const STANDALONE_ONBOARDING_ROUTES = new Set(["", "/", "/welcome", "/pair-scan"]);

function isSettingsPathname(pathname: string): boolean {
  return (
    pathname === "/settings" || pathname.startsWith("/settings/") || pathname.endsWith("/settings")
  );
}

const ignoreOpenChange = () => {};

/**
 * The compact sidebar is shadcn's sheet; its open state mirrors the panel store's mobile panel so
 * shared code that opens or closes "agent-list" drives it, and a dismissed sheet updates the store.
 */
function MobileSidebarSync() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const target = usePanelStore((state) => state.mobilePanel.target);
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);
  const storeOpen = isMobile && target === "agent-list";

  useEffect(() => {
    setOpenMobile(storeOpen);
  }, [setOpenMobile, storeOpen]);

  useEffect(() => {
    if (!isMobile) return;
    if (openMobile && target !== "agent-list") showMobileAgentList();
    if (!openMobile && target === "agent-list") showMobileAgent();
    // Only a change of the sheet itself is a user action to mirror back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMobile]);

  return null;
}

export function AppChrome() {
  const isCompactLayout = useIsCompactFormFactor();
  // As packages/app's AppContainer: on a phone the page does not zoom (pinch, or iOS zooming into
  // a focused field).
  useCompactWebViewportZoomLock(isCompactLayout);
  // Phone panels slide and follow the finger; on a desktop the runtime only reports the panel.
  return (
    <MobilePanelsProvider enabled={isCompactLayout}>
      <AppChromeContent />
    </MobilePanelsProvider>
  );
}

function AppChromeContent() {
  const { pathname } = useLocation();
  const hosts = useHosts();
  const storeReady = useStoreReady();
  const isCompactLayout = useIsCompactFormFactor();
  const { width: viewportWidth } = useWindowDimensions();
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const { settings, updateSettings } = useAppSettings();

  const routeServerId = useMemo(() => parseServerIdFromPathname(pathname), [pathname]);
  const hasInvalidHostParam =
    routeServerId !== null && !hosts.some((host) => host.serverId === routeServerId);
  const isSettingsRoute = isSettingsPathname(pathname);
  const chromeEnabled =
    storeReady &&
    !STANDALONE_ONBOARDING_ROUTES.has(pathname) &&
    !isSettingsRoute &&
    !hasInvalidHostParam;

  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const exitFocusMode = usePanelStore((state) => state.exitFocusMode);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const isDesktopAgentListOpen = usePanelStore((state) => state.desktop.agentListOpen);
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const isWorkspaceFocusModeEnabled =
    parseHostWorkspaceRouteFromPathname(pathname) !== null && isFocusModeEnabled;
  const toggleAgentList = isCompactLayout ? toggleMobileAgentList : toggleDesktopAgentList;

  const cycleTheme = useCallback(() => {
    void updateSettings({ theme: getNextThemePreference(settings.theme) });
  }, [settings.theme, updateSettings]);

  const toggleBothSidebars = useCallback(() => {
    // The focused workspace owns the explorer, so it answers first; elsewhere there is only the list.
    if (keyboardActionDispatcher.dispatch({ id: "sidebar.toggle.both", scope: "sidebar" })) return;
    toggleAgentList();
  }, [keyboardActionDispatcher, toggleAgentList]);

  const keyboardShortcutsEnabled = chromeEnabled || pathname.startsWith("/settings");
  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled,
    isMobile: isCompactLayout,
    isWorkspaceFocusModeEnabled,
    toggleAgentList,
    toggleBothSidebars,
    exitFocusMode,
    cycleTheme,
  });
  useActiveWorktreeNewAction();
  useGlobalNewWorkspaceAction();

  const desktopSidebarVisible = resolveDesktopSidebarVisibility({
    chromeEnabled,
    isCompactLayout,
    isMounted: !isWorkspaceFocusModeEnabled,
    isOpen: isDesktopAgentListOpen,
    canShare: canDesktopAppSidebarShare({
      contentMinimumWidth: resolveDesktopAppContentMinimum({ isSettingsRoute }),
      requestedSidebarWidth: sidebarWidth,
      viewportWidth,
    }),
  });
  const sidebarActive = isCompactLayout ? chromeEnabled : desktopSidebarVisible;
  // packages/app's MobileGestureWrapper: a swipe in from the left edge opens the sidebar.
  useMobilePanelOpenGesture("agent-list", { enabled: isCompactLayout && chromeEnabled });

  // A drag previews its width locally and commits to the store on release.
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const visibleSidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: draftWidth ?? sidebarWidth,
    viewportWidth,
  });
  const providerStyle = useMemo(
    () => ({ "--sidebar-width": `${visibleSidebarWidth}px` }) as CSSProperties,
    [visibleSidebarWidth],
  );

  // Settings own their split layout and run full-bleed; every other desktop route sits in the
  // inset card (the frame stays when the sidebar is closed), compact layouts never frame.
  const framed = !isSettingsRoute;
  // On a phone the explorer is a sheet over the page instead of a docked pane.
  const content = isCompactLayout ? (
    <CompactExplorerSidebarHost enabled={chromeEnabled}>
      <Outlet />
    </CompactExplorerSidebarHost>
  ) : (
    <Outlet />
  );

  return (
    <CommandCenterProvider>
      <DesktopSidebarVisibilityProvider visible={desktopSidebarVisible}>
        <SidebarModelProvider active={sidebarActive}>
          <SidebarProvider
            open={desktopSidebarVisible}
            onOpenChange={ignoreOpenChange}
            style={providerStyle}
            className="h-svh"
          >
            <MobileSidebarSync />
            {framed ? (
              <Sidebar variant="inset" className="p-0" data-testid="left-sidebar">
                {chromeEnabled ? <AppSidebar /> : null}
                {chromeEnabled && !isCompactLayout ? (
                  <SidebarResizeHandle
                    width={visibleSidebarWidth}
                    viewportWidth={viewportWidth}
                    onPreview={setDraftWidth}
                  />
                ) : null}
              </Sidebar>
            ) : null}
            {/* BySpace: packages/app's framed card — 6px from the window, 12px radius, a 1px
                border instead of shadcn's 8px margin and shadow. */}
            {framed ? (
              <SidebarInset className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:m-1.5 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-[12px] md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:shadow-none md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-1.5">
                {content}
              </SidebarInset>
            ) : (
              <main className="min-h-0 flex-1 overflow-hidden">{content}</main>
            )}
          </SidebarProvider>
          <WorkspaceShortcutTargetsSubscriber enabled={keyboardShortcutsEnabled} />
        </SidebarModelProvider>
        <WorktreeSetupCalloutSource />
        <CommandCenterRootActions />
        <CommandCenterWorkspaceActions />
        <WorkspacePinShortcutHandler />
        <WorkspaceRenameHost />
        <CommandCenter />
        <HostChooserModal />
      </DesktopSidebarVisibilityProvider>
    </CommandCenterProvider>
  );
}
