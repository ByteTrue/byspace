import { CompactExplorerSidebarHost } from "@/components/compact-explorer-sidebar-host";
import { useCallback, useEffect, useMemo, type CSSProperties } from "react";
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
import { useImportSession } from "@/hooks/use-import-session";
import { useAppSettings } from "@/hooks/use-settings";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useHosts } from "@/runtime/host-runtime";
import { usePanelStore } from "@/stores/panel-store";
import { getNextThemePreference } from "@/styles/theme";
import {
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
} from "@/utils/host-routes";
import { AppSidebar } from "~/app/app-sidebar";
import { SidebarResizeRail } from "~/app/sidebar-resize-rail";
import { WorkspaceLayer } from "~/app/workspace-layer";
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from "~/components/ui/sidebar";
import { cn } from "cn";
import { useWindowDimensions } from "~/hooks/use-window-dimensions";

// Routes that stand alone without app chrome, as in the Expo app's root layout.
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
  // As the Expo app's AppContainer: on a phone the page does not zoom (pinch, or iOS zooming into
  // a focused field).
  useCompactWebViewportZoomLock(isCompactLayout);
  // Phone panels slide and follow the finger; on a desktop the runtime only reports the panel.
  return <AppChromeContent />;
}

function AppChromeContent() {
  const { pathname } = useLocation();
  const hosts = useHosts();
  const storeReady = useStoreReady();
  const isCompactLayout = useIsCompactFormFactor();
  const { width: viewportWidth } = useWindowDimensions();
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();
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
  const storedSidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const sidebarWidth = resolveDesktopSidebarWidth({
    requestedWidth: storedSidebarWidth,
    viewportWidth,
  });
  // shadcn's width variable; while the rail drags, the rail writes it directly (sidebar-resize-rail).
  const providerStyle = useMemo(
    () => ({ "--sidebar-width": `${sidebarWidth}px` }) as CSSProperties,
    [sidebarWidth],
  );
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
      sidebarWidth,
      viewportWidth,
    }),
  });
  const sidebarActive = isCompactLayout ? chromeEnabled : desktopSidebarVisible;
  // Settings own their split layout and run full-bleed; every other desktop route sits in the
  // inset card (the frame stays when the sidebar is closed), compact layouts never frame.
  const framed = !isSettingsRoute;
  // On a phone the explorer is a sheet over the page instead of a docked pane.
  const routed = (
    <WorkspaceLayer>
      <Outlet />
    </WorkspaceLayer>
  );
  const content = isCompactLayout ? (
    <CompactExplorerSidebarHost enabled={chromeEnabled}>{routed}</CompactExplorerSidebarHost>
  ) : (
    routed
  );

  return (
    <CommandCenterProvider>
      <DesktopSidebarVisibilityProvider visible={desktopSidebarVisible}>
        <SidebarModelProvider active={sidebarActive}>
          <SidebarProvider
            open={desktopSidebarVisible}
            onOpenChange={ignoreOpenChange}
            style={providerStyle}
            // No width animation while the rail drags: the sidebar follows the pointer.
            className="h-svh data-resizing:**:data-[slot=sidebar-container]:transition-none data-resizing:**:data-[slot=sidebar-gap]:transition-none"
          >
            <MobileSidebarSync />
            {framed ? (
              <Sidebar variant="inset" data-testid="left-sidebar">
                {chromeEnabled ? <AppSidebar onImportSession={openImportSession} /> : null}
                {/* Focus mode hides the sidebar on purpose; the rail would only toggle it unseen. */}
                {chromeEnabled && !isCompactLayout && !isWorkspaceFocusModeEnabled ? (
                  <SidebarResizeRail width={sidebarWidth} viewportWidth={viewportWidth} />
                ) : null}
              </Sidebar>
            ) : null}
            {/* One element for both, so a workspace covered by Settings stays mounted (the
                workspace layer); Settings run full-bleed as a plain block. */}
            {importSessionSheet}
            <SidebarInset
              className={cn("min-h-0 overflow-hidden", !framed && "block flex-1 bg-transparent")}
            >
              {content}
            </SidebarInset>
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
