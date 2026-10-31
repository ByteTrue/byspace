#!/usr/bin/env python3
"""Port packages/app's workspace-screen.tsx to web/src/overrides: same logic, DOM + Tailwind view."""
import os

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = str(ROOT / "packages/app/src/screens/workspace/workspace-screen.tsx")
DST = str(ROOT / "web/src/overrides/screens/workspace/workspace-screen.tsx")

s = open(SRC, encoding="utf-8").read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of:\n{old[:200]}\n--- found {n}")
    s = s.replace(old, new)


# ---- imports ----
rep('import { LoadingSpinner } from "@/components/ui/loading-spinner";\n', 'import { Spinner } from "~/components/ui/spinner";\n')
rep('import { useIsFocused } from "@react-navigation/native";\n', "")
rep('import { BackHandler, Keyboard, Pressable, Text, View } from "react-native";\n', 'import { Keyboard } from "react-native";\n')
rep('import { ChevronDown } from "lucide-react-native";\n', 'import { ChevronDown } from "lucide-react";\n')
rep('import { useSafeAreaInsets } from "react-native-safe-area-context";\n', "")
rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n', "")
rep('import type { Theme } from "@/styles/theme";\n', "")
rep('import { Combobox, type ComboboxOption } from "@/components/ui/combobox";\n',
    'import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "~/components/ui/drawer";\n')
rep('''import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
''', "")
rep('import { useVisibleAgentIds } from "./visible-agent-ids";', 'import { useVisibleAgentIds } from "@/screens/workspace/visible-agent-ids";')
rep('import { isWeb } from "@/constants/platform";\n', "")

rep('''import {
  memo,
  useCallback,''', '''import {
  Fragment,
  memo,
  useCallback,''')
# ---- module constants ----
rep('''const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedChevronDown = withUnistyles(ChevronDown);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

''', "")
rep('const WORKSPACE_FLOATING_PANEL_PORTAL_HOST_PREFIX = "workspace-floating-panels";\n', "")

# ComboboxOption type (the Expo Combobox is not loaded on the web)
rep('''interface MobileWorkspaceTabSwitcherProps {''', '''interface ComboboxOption {
  id: string;
  label: string;
  description?: string;
}

interface MobileWorkspaceTabSwitcherProps {''')

# ---- mobile active tab trigger ----
rep('''          <View style={styles.switcherTriggerIcon} testID="workspace-active-tab-icon">
            <WorkspaceTabIcon presentation={presentation} active backdrop={backdrop} />
          </View>

          <Text style={styles.switcherTriggerText} numberOfLines={1}>
            {presentation.titleState === "loading"
              ? t("workspace.tabs.loading")
              : presentation.label}
          </Text>''', '''          <span className="shrink-0" data-testid="workspace-active-tab-icon">
            <WorkspaceTabIcon presentation={presentation} active backdrop={backdrop} />
          </span>

          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {presentation.titleState === "loading"
              ? t("workspace.tabs.loading")
              : presentation.label}
          </span>''')
rep('''function switcherTriggerStyle({ pressed }: { pressed?: boolean }) {
  return [styles.switcherTrigger, Boolean(pressed) && styles.switcherTriggerPressed];
}

''', "")

# ---- mobile tab switcher: Combobox -> Popover list ----
rep('''  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const tabIndexByKey''', '''  const [isOpen, setIsOpen] = useState(false);
  const tabIndexByKey''')
rep('''      const tab = tabByKey.get(option.id);
      if (!tab) {
        return <View />;
      }
      const tabIndex = tabIndexByKey.get(tab.key) ?? -1;
      if (tabIndex < 0) {
        return <View />;
      }''', '''      const tab = tabByKey.get(option.id);
      if (!tab) {
        return <div />;
      }
      const tabIndex = tabIndexByKey.get(tab.key) ?? -1;
      if (tabIndex < 0) {
        return <div />;
      }''')
rep('''  return (
    <View style={styles.mobileTabsRow} testID="workspace-tabs-row">
      <Pressable
        ref={anchorRef}
        testID="workspace-tab-switcher-trigger"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.switcher.trigger", { count: tabs.length })}
        style={switcherTriggerStyle}
        onPress={handleOpenSwitcher}
      >
        {({ pressed }) => (
          <>
            <View style={styles.switcherTriggerLeft}>
              <MobileActiveTabTrigger
                activeTab={activeTab}
                normalizedServerId={normalizedServerId}
                normalizedWorkspaceId={normalizedWorkspaceId}
                backdrop={pressed ? "surface1" : "surface0"}
              />
            </View>
            <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
          </>
        )}
      </Pressable>

      <Combobox
        options={tabSwitcherOptions}
        value={activeTabKey}
        onSelect={onSelectSwitcherTab}
        searchable={false}
        title={t("workspace.tabs.switcher.title")}
        searchPlaceholder={t("workspace.tabs.switcher.searchPlaceholder")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        renderOption={renderTabOption}
      />
    </View>
  );''', '''  // The phone switcher is a bottom drawer, as packages/app's Combobox sheet is on compact layouts.
  return (
    <div className="flex items-center border-b bg-background" data-testid="workspace-tabs-row">
      <button
        type="button"
        data-testid="workspace-tab-switcher-trigger"
        aria-label={t("workspace.tabs.switcher.trigger", { count: tabs.length })}
        className="flex min-w-0 shrink items-center gap-2 px-5 py-2 active:bg-card"
        onClick={handleOpenSwitcher}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <MobileActiveTabTrigger
            activeTab={activeTab}
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            backdrop="surface0"
          />
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerContent data-testid="workspace-tab-switcher">
          <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle>{t("workspace.tabs.switcher.title")}</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto pb-4">
            {tabSwitcherOptions.map((option) => (
              <Fragment key={option.id}>
                {renderTabOption({
                  option,
                  selected: option.id === activeTabKey,
                  active: false,
                  onPress: () => {
                    onSelectSwitcherTab(option.id);
                    setIsOpen(false);
                  },
                })}
              </Fragment>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );''')

# ---- mounted tab slot ----
rep('''  const handleTouch = useCallback(() => {
    if (!isPaneFocused && paneId) onFocusPane(paneId);
    return false;
  }, [isPaneFocused, onFocusPane, paneId]);

  return (
    <RenderProfile id={`MobileMountedTabSlot:${tabDescriptor.kind}:${tabDescriptor.tabId}`}>
      <RetainedPanel active={isVisible} style={styles.mobileMountedTabSlot}>
        <View style={styles.mobileMountedTabSlot} onStartShouldSetResponderCapture={handleTouch}>
          <WorkspacePaneContent
            content={content}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused={isPaneFocused}
          />
        </View>
      </RetainedPanel>
    </RenderProfile>
  );''', '''  const handleTouch = useCallback(() => {
    if (!isPaneFocused && paneId) onFocusPane(paneId);
  }, [isPaneFocused, onFocusPane, paneId]);

  return (
    <RenderProfile id={`MobileMountedTabSlot:${tabDescriptor.kind}:${tabDescriptor.tabId}`}>
      <RetainedPanel active={isVisible} className="absolute inset-0">
        <div className="absolute inset-0 flex flex-col" onPointerDownCapture={handleTouch}>
          <WorkspacePaneContent
            content={content}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused={isPaneFocused}
          />
        </div>
      </RetainedPanel>
    </RenderProfile>
  );''')

# ---- WorkspaceScreen: the web route is focused while mounted ----
rep('''  const navigationFocused = useIsFocused();
  useEffect(() => {''', '''  useEffect(() => {''')
rep('''      isRouteFocused={isRouteFocused ?? navigationFocused}''', '''      isRouteFocused={isRouteFocused ?? true}''')

# ---- header project row ----
rep('''  return (
    <View style={styles.headerProjectRow}>
      {showProject ? (
        <Text
          testID="workspace-header-subtitle"
          style={styles.headerProjectTitle}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      ) : null}
      {showProject && hostBadge ? <Text style={styles.headerProjectSeparator}>·</Text> : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );''', '''  return (
    <span className="flex min-w-0 shrink items-center gap-1.5">
      {showProject ? (
        <span
          data-testid="workspace-header-subtitle"
          className="min-w-0 shrink truncate text-sm text-muted-foreground"
        >
          {subtitle}
        </span>
      ) : null}
      {showProject && hostBadge ? (
        <span className="shrink-0 text-xs text-muted-foreground/70">·</span>
      ) : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </span>
  );''')

# ---- header title bar ----
rep('''  return (
    <View style={styles.headerTitleContainer}>
      {isLoading ? (
        <View style={styles.headerTitleTextGroup}>
          <View style={styles.headerTitleSkeleton} />
        </View>
      ) : (
        <View style={styles.headerTitleTextGroup}>
          <ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>
          <WorkspaceHeaderProjectRow
            subtitle={subtitle}
            isSubtitleDistinct={isSubtitleDistinct}
            serverId={normalizedServerId}
          />
        </View>
      )}
      <View style={styles.compactHeaderMenuCluster}>''', '''  return (
    <div className="flex min-w-0 flex-1 shrink items-center gap-1 overflow-hidden md:gap-2">
      {isLoading ? (
        <div className={HEADER_TITLE_TEXT_GROUP}>
          <div className="h-[22px] w-[220px] max-w-full rounded-full bg-muted-foreground/25" />
        </div>
      ) : (
        <div className={HEADER_TITLE_TEXT_GROUP}>
          <ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>
          <WorkspaceHeaderProjectRow
            subtitle={subtitle}
            isSubtitleDistinct={isSubtitleDistinct}
            serverId={normalizedServerId}
          />
        </div>
      )}
      <div className="flex items-center md:gap-2">''')
rep('''            hideLabels
            presentation="ghost"
          />
        ) : null}
      </View>
    </View>
  );
}''', '''            hideLabels
            presentation="ghost"
          />
        ) : null}
      </div>
    </div>
  );
}

// Column on a phone (title over project), one row on desktop.
const HEADER_TITLE_TEXT_GROUP =
  "flex min-w-0 shrink grow flex-col items-stretch justify-start overflow-hidden md:grow-0 md:flex-row md:items-center md:gap-2";''')

# ---- empty states ----
rep('''    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>
          Workspace directory is missing. Reload workspace data before opening tabs.
        </Text>
      </View>
    );''', '''    return (
      <div className={EMPTY_STATE}>
        <p className="text-center text-muted-foreground">
          Workspace directory is missing. Reload workspace data before opening tabs.
        </p>
      </div>
    );''')
rep('''    return (
      <View style={styles.emptyState}>
        <ThemedLoadingSpinner uniProps={mutedColorMapping} />
      </View>
    );''', '''    return (
      <div className={EMPTY_STATE}>
        <Spinner className="text-muted-foreground" />
      </div>
    );''')
rep('''    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>
          No tabs are available yet. Use New tab to create an agent or terminal.
        </Text>
      </View>
    );''', '''    return (
      <div className={EMPTY_STATE}>
        <p className="text-center text-muted-foreground">
          No tabs are available yet. Use New tab to create an agent or terminal.
        </p>
      </div>
    );''')
rep('''function renderWorkspaceContent(input: RenderWorkspaceContentInput): React.ReactNode {''', '''const EMPTY_STATE = "flex flex-1 flex-col items-center justify-center gap-3 px-6";

// Pulls the explorer toggle's glyph onto the header's right padding rail (spacing[2]).
const EXPLORER_TOGGLE_PULL_STYLE = { marginRight: -8 };

function renderWorkspaceContent(input: RenderWorkspaceContentInput): React.ReactNode {''')

# ---- gate frame, panel content, gate shell ----
rep('''      <ScreenHeader left={GATED_WORKSPACE_HEADER_LEFT} />
      <View style={styles.centerContent}>{children}</View>''', '''      <ScreenHeader left={GATED_WORKSPACE_HEADER_LEFT} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>''')
rep('''    <NewTabLauncherProvider value={launcher}>
      <View style={styles.content}>{content}</View>
    </NewTabLauncherProvider>''', '''    <NewTabLauncherProvider value={launcher}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">{content}</div>
    </NewTabLauncherProvider>''')
rep('''    <WorkspaceFocusProvider workspaceKey={input.workspaceKey}>
      <View style={styles.container}>
        <View style={styles.threePaneRow}>
          <View style={styles.centerColumn}>
            <WorkspaceScreenGateFrame>{input.gate}</WorkspaceScreenGateFrame>
          </View>
        </View>
      </View>
    </WorkspaceFocusProvider>''', '''    <WorkspaceFocusProvider workspaceKey={input.workspaceKey}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <WorkspaceScreenGateFrame>{input.gate}</WorkspaceScreenGateFrame>
          </div>
        </div>
      </div>
    </WorkspaceFocusProvider>''')
rep('''  if (!isRouteFocused || !isWeb || !tab) {''', '''  if (!isRouteFocused || !tab) {''')

# ---- content: insets, back handler ----
rep('''  const _insets = useSafeAreaInsets();
''', "")
rep('''  useEffect(() => {
    // Back dismisses the compact overlay only. On a wide native layout the
    // explorer is a tab, `showMobileAgent` has no rendered consumer, and
    // returning true would swallow Back with nothing to show for it.
    if (!isRouteFocused || isWeb || !isMobile || !isExplorerSidebarShowing) {
      return;
    }

    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      showMobileAgent();
      return true;
    });

    return () => handler.remove();
  }, [isExplorerSidebarShowing, isMobile, isRouteFocused, showMobileAgent]);

''', "")

# ---- header right ----
rep('''      <View style={styles.headerRight}>
        <PluginHeaderButtons''', '''      <div className="flex items-center gap-1 md:gap-2">
        <PluginHeaderButtons''')
rep('''              tooltipKeys={EXPLORER_TOGGLE_KEYS}
              style={styles.compactHeaderActionButton}
              accessibilityState={explorerSidebarToggleAccessibilityState}
            />
          </>
        ) : null}''', '''              tooltipKeys={EXPLORER_TOGGLE_KEYS}
              style={EXPLORER_TOGGLE_PULL_STYLE}
              accessibilityState={explorerSidebarToggleAccessibilityState}
            />
          </>
        ) : null}''')
rep('''            mobile
          />
        ) : null}
      </View>
    ),''', '''            mobile
          />
        ) : null}
      </div>
    ),''')
rep('''        accessibilityState={explorerSidebarToggleAccessibilityState}
        style={styles.explorerSidebarToggleSlot}
      />''', '''        accessibilityState={explorerSidebarToggleAccessibilityState}
        style={EXPLORER_TOGGLE_PULL_STYLE}
      />''')
rep('''  const workspaceFloatingPanelPortalHostName = useMemo(
    () =>
      `${WORKSPACE_FLOATING_PANEL_PORTAL_HOST_PREFIX}:${normalizedServerId}:${normalizedWorkspaceId}`,
    [normalizedServerId, normalizedWorkspaceId],
  );
''', "")
rep('''  const containerStyle = [styles.container, styles.containerWorkspaceBackground];

''', "")

# ---- center column and screen ----
rep('''  const workspaceCenterColumn = (
    <View style={styles.centerColumn}>''', '''  const workspaceCenterColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">''')
rep('''      <View style={styles.centerContent}>{workspacePanelContent}</View>
    </View>
  );''', '''      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{workspacePanelContent}</div>
    </div>
  );''')
rep('''      <View style={containerStyle}>
        <WorkspaceDocumentTitleEffectSlot''', '''      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspaceDocumentTitleEffectSlot''')
rep('''        <View style={styles.threePaneRow}>
          <FloatingPanelPortalHostNameProvider hostName={workspaceFloatingPanelPortalHostName}>
            {workspaceCenterColumn}
          </FloatingPanelPortalHostNameProvider>
          <FloatingPanelPortalHost name={workspaceFloatingPanelPortalHostName} />
        </View>''', '''        <div className="flex min-h-0 min-w-0 flex-1 items-stretch">{workspaceCenterColumn}</div>''')
rep('''          onClose={handleRenameModalClose}
        />
      </View>
    </RenderProfile>''', '''          onClose={handleRenameModalClose}
        />
      </div>
    </RenderProfile>''')

# ---- styles ----

start = s.index("const styles = StyleSheet.create((theme) => ({")
end = s.index("const EXPLORER_TOGGLE_KEYS")
s = s[:start] + s[end:]

header = """// Override of packages/app/src/screens/workspace/workspace-screen.tsx. The logic is the Expo
// file's, unchanged; the view is DOM and Tailwind. Keep the two in step until the cutover deletes
// packages/app.
// Generated from the Expo file by web/scripts/port/workspace-screen.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
"""
os.makedirs(os.path.dirname(DST), exist_ok=True)
open(DST, "w", encoding="utf-8").write(header + s)
for needle in ["<View", "<Text", "<Pressable", "styles.", "StyleSheet", "withUnistyles", "uniProps"]:
    if needle in s:
        idx = s.index(needle)
        raise SystemExit(f"leftover {needle}: {s[idx-80:idx+120]}")
print("ok", len(s.splitlines()))
