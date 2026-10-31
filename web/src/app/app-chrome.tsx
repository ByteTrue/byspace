import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router";
import { useStoreReady } from "@/app/_layout";
import {
  canDesktopAppSidebarShare,
  resolveDesktopAppContentMinimum,
  resolveDesktopSidebarVisibility,
  resolveDesktopSidebarWidth,
} from "@/components/desktop-sidebar-layout";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";
import { WorkspacePinShortcutHandler } from "@/components/workspace-pin-shortcut-handler";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { WorktreeSetupCalloutSource } from "@/components/worktree-setup-callout-source";
import { useIsCompactFormFactor } from "@/constants/layout";
import { DesktopSidebarVisibilityProvider } from "@/contexts/desktop-sidebar-visibility-context";
import { useActiveWorktreeNewAction } from "@/hooks/use-active-worktree-new-action";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useAppSettings } from "@/hooks/use-settings";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
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

  return (
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
            <Sidebar variant="inset" data-testid="left-sidebar">
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
          {framed ? (
            <SidebarInset className="min-h-0 overflow-hidden">
              <Outlet />
            </SidebarInset>
          ) : (
            <main className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          )}
        </SidebarProvider>
        <WorkspaceShortcutTargetsSubscriber enabled={keyboardShortcutsEnabled} />
      </SidebarModelProvider>
      <WorktreeSetupCalloutSource />
      <WorkspacePinShortcutHandler />
    </DesktopSidebarVisibilityProvider>
  );
}
