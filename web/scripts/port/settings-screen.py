#!/usr/bin/env python3
"""Port packages/app's settings screen (screens/settings-screen.tsx): the settings sidebar (app
sections, host picker, host sections), the detail pane, General and About, the add-host flow and
the compact list/detail layout. Routing, host scoping and every handler are the Expo file's; the
view is DOM."""
from _port import Port

THEME_TRIGGER = "flex flex-row items-center gap-1 rounded-md border px-2 py-1 active:opacity-85"
# packages/app's plain TextInput: the border stays on focus and the app-wide outline draws.
INPUT = "min-h-9 rounded-[10px] border border-input bg-transparent px-2.5 py-2 text-foreground placeholder:text-muted-foreground md:min-h-8 md:py-1 dark:bg-input/30"
ITEM = "relative flex min-h-[34px] w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent md:min-h-8"
INDICATOR = "pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground"
LIST = "flex flex-col gap-1 p-2"
GROUP_LABEL = "px-2 py-1 text-xs font-medium text-muted-foreground"

p = Port("screens/settings-screen.tsx")

# ---------------------------------------------------------------- imports
p.rep('import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";\n', "")
p.rep('import { useSafeAreaInsets } from "react-native-safe-area-context";\n', "")
p.rep('import { StyleSheet, useUnistyles } from "react-native-unistyles";', 'import { useUnistyles } from "react-native-unistyles";\nimport { cn } from "cn";')
p.rep('} from "lucide-react-native";', '} from "lucide-react";')

# ---------------------------------------------------------------- style helpers
p.between("function themeTriggerStyle({ pressed }: PressableStateCallbackType) {",
          "function getSendBehaviorOptions(t: TFunction) {",
          f'''const THEME_TRIGGER = "{THEME_TRIGGER}";
const SIDEBAR_ITEM = "{ITEM}";
const SELECTED_INDICATOR = "{INDICATOR}";

''')

# ---------------------------------------------------------------- General
p.rep('''            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={`${t("settings.general.defaultSend.label")}: ${selectedSendBehaviorLabel}`}
              style={themeTriggerStyle}
            >
              <Text style={styles.themeTriggerText}>{selectedSendBehaviorLabel}</Text>''', '''            <DropdownTrigger
              accessibilityLabel={`${t("settings.general.defaultSend.label")}: ${selectedSendBehaviorLabel}`}
              className={THEME_TRIGGER}
            >
              <span className="text-sm leading-[normal] text-foreground">{selectedSendBehaviorLabel}</span>''')
p.rep('''            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={selectedLanguageLabel}
              style={themeTriggerStyle}
            >
              <Text style={styles.themeTriggerText}>{selectedLanguageLabel}</Text>''', '''            <DropdownTrigger accessibilityLabel={selectedLanguageLabel} className={THEME_TRIGGER}>
              <span className="text-sm leading-[normal] text-foreground">{selectedLanguageLabel}</span>''')
p.rep("<View style={[settingsStyles.row, settingsStyles.rowBorder]}>",
      "<View className={cn(settingsStyles.row, settingsStyles.rowBorder)}>", 3)
p.rep("            style={styles.terminalScrollbackInput}",
      f'            className="{INPUT} w-28 text-right text-sm"')

# ---------------------------------------------------------------- About
p.rep('''      <View style={[settingsStyles.row, settingsStyles.rowBorder]} testID="app-diagnostic-row">''',
      '''      <View
        className={cn(settingsStyles.row, settingsStyles.rowBorder)}
        data-testid="app-diagnostic-row"
      >''')
p.rep('''      <View style={styles.aboutCommunity}>
        <CommunityLinks />''', '''      <View className="mt-4">
        <CommunityLinks />''')
p.between('''function WhatsNewRow() {''', '''function normalizeVersion(''', '''function WhatsNewRow() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  return (
    <button
      type="button"
      className={cn(
        settingsStyles.row,
        settingsStyles.rowBorder,
        "group/whats-new w-full text-left",
      )}
      onClick={openChangelog}
      data-testid="settings-whats-new"
    >
      <span className={settingsStyles.rowContent}>
        <span className={settingsStyles.rowTitle}>{t("changelog.title")}</span>
        <span className={settingsStyles.rowHint}>{t("settings.about.whatsNewHint")}</span>
      </span>
      <ChevronRight
        size={theme.iconSize.sm}
        className="text-muted-foreground group-hover/whats-new:text-foreground"
      />
    </button>
  );
}

''')
p.rep('''  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
''', "")
p.rep('''  const valueStyle = useMemo(
    () => [styles.aboutValue, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>''', '''  return (
    <View className={cn(settingsStyles.row, showBorder && settingsStyles.rowBorder)}>
      <View className={settingsStyles.rowContent}>
        <Text className={cn(settingsStyles.rowTitle, "truncate")}>{host.label}</Text>''')
p.rep('''      <Text style={valueStyle}>{valueText}</Text>''',
      '''      <Text className={cn("text-sm text-muted-foreground", isMismatch && "text-amber-500")}>
        {valueText}
      </Text>''')

# ---------------------------------------------------------------- sidebar buttons
for kind, testid_line in (("Section", ""), ("HostSection", "      testID={`settings-host-section-${itemId}`}\n")):
    p.rep(f'''  const accessibilityState = useMemo(() => ({{ selected: isSelected }}), [isSelected]);
  const labelStyle = [sidebarStyles.label, isSelected && sidebarStyles.labelSelected];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{accessibilityState}}
      onPress={{handlePress}}
{testid_line}      style={{isSelected ? selectedSidebarItemStyle : sidebarItemStyle}}
    >
      {{isSelected ? (
        <View pointerEvents="none" aria-hidden style={{sidebarStyles.selectedIndicator}} />
      ) : null}}
      <IconComponent
        size={{theme.iconSize.md}}
        color={{isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}}
      />
      <Text style={{labelStyle}} numberOfLines={{1}}>
        {{label}}
      </Text>
    </Pressable>
  );''', f'''  return (
    <button
      type="button"
      aria-current={{isSelected ? "page" : undefined}}
      onClick={{handlePress}}
{testid_line.replace("testID=", "data-testid=")}      className={{cn(SIDEBAR_ITEM, isSelected && "bg-sidebar-accent")}}
    >
      {{isSelected ? <span aria-hidden className={{SELECTED_INDICATOR}} /> : null}}
      <IconComponent
        size={{theme.iconSize.md}}
        color={{isSelected ? theme.colors.foreground : theme.colors.foregroundMuted}}
      />
      <span
        className={{cn(
          "min-w-0 flex-1 truncate text-sm text-foreground",
          isSelected && "font-medium",
        )}}
      >
        {{label}}
      </span>
    </button>
  );''')

# ---------------------------------------------------------------- host picker
p.rep("  const triggerRef = useRef<View | null>(null);", "  const triggerRef = useRef<HTMLButtonElement | null>(null);")
p.rep('''  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      sidebarStyles.pickerTrigger,
      hovered && sidebarStyles.pickerTriggerHovered,
    ],
    [],
  );
''', "")
p.rep('''        block
        style={triggerStyle}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={t("settings.hostPicker.switchHost")}
        testID="settings-host-picker"
      >
        {activeHost ? (
          <View style={sidebarStyles.pickerTriggerDot}>
            <HostStatusDot serverId={activeHost.serverId} />
          </View>
        ) : null}
        <Text style={sidebarStyles.pickerTriggerLabel} numberOfLines={1}>
          {activeHost?.label ?? t("settings.groups.host")}
        </Text>''', '''        block
        className="flex min-h-[34px] w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-sidebar-accent"
        onPress={handleOpen}
        accessibilityLabel={t("settings.hostPicker.switchHost")}
        testID="settings-host-picker"
      >
        {activeHost ? (
          <View className="flex size-4 items-center justify-center">
            <HostStatusDot serverId={activeHost.serverId} />
          </View>
        ) : null}
        <Text className="min-w-0 flex-1 truncate text-sm text-foreground">
          {activeHost?.label ?? t("settings.groups.host")}
        </Text>''')

# ---------------------------------------------------------------- sidebar
p.rep('''  const insets = useSafeAreaInsets();
  const isDesktop = layout === "desktop";
  const outerContainerStyle = useMemo(
    () => [isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer],
    [isDesktop],
  );
  const innerContainerStyle = useMemo(
    () => [{ flex: 1 }, isDesktop ? { paddingTop: insets.top } : null],
    [insets.top, isDesktop],
  );''', '''  const isDesktop = layout === "desktop";''')
p.rep(f'''      <View style={{sidebarStyles.list}}>
        <Text style={{sidebarStyles.groupLabel}}>{{t("settings.groups.app")}}</Text>''',
      f'''      <View className="{LIST}">
        <Text className="{GROUP_LABEL}">{{t("settings.groups.app")}}</Text>''')
p.rep(f'''        <View style={{sidebarStyles.list}}>
          <Text style={{sidebarStyles.groupLabel}}>{{t("settings.groups.host")}}</Text>''',
      f'''        <View className="{LIST}">
          <Text className="{GROUP_LABEL}">{{t("settings.groups.host")}}</Text>''')
p.rep('''        <View style={sidebarStyles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.addHost")}
            onPress={onAddHost}
            testID="settings-add-host"
            style={sidebarItemStyle}
          >
            <Plus size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
            <Text style={sidebarStyles.label} numberOfLines={1}>
              {t("settings.addHost")}
            </Text>
          </Pressable>
          {enableBuiltInDaemonOption.visible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.enableBuiltInDaemon")}
              onPress={enableBuiltInDaemonOption.onPress}
              testID="settings-enable-built-in-daemon"
              style={sidebarItemStyle}
            >
              <Server size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              <Text style={sidebarStyles.label} numberOfLines={1}>
                {t("settings.enableBuiltInDaemon")}
              </Text>
            </Pressable>
          ) : null}''', f'''        <View className="{LIST}">
          <button
            type="button"
            aria-label={{t("settings.addHost")}}
            onClick={{onAddHost}}
            data-testid="settings-add-host"
            className={{SIDEBAR_ITEM}}
          >
            <Plus size={{theme.iconSize.md}} color={{theme.colors.foregroundMuted}} />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {{t("settings.addHost")}}
            </span>
          </button>
          {{enableBuiltInDaemonOption.visible ? (
            <button
              type="button"
              aria-label={{t("settings.enableBuiltInDaemon")}}
              onClick={{enableBuiltInDaemonOption.onPress}}
              data-testid="settings-enable-built-in-daemon"
              className={{SIDEBAR_ITEM}}
            >
              <Server size={{theme.iconSize.md}} color={{theme.colors.foregroundMuted}} />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {{t("settings.enableBuiltInDaemon")}}
              </span>
            </button>
          ) : null}}''')
p.rep('''    <View
      accessibilityLabel={t("settings.title")}
      role="navigation"
      style={outerContainerStyle}
      testID="settings-sidebar"
    >
      {isDesktop ? (
        <View style={innerContainerStyle}>
          <View style={sidebarStyles.sidebarDragArea}>''', '''    <nav
      aria-label={t("settings.title")}
      className={cn(isDesktop ? "flex shrink-0 flex-col bg-sidebar" : "p-2")}
      style={isDesktop ? SIDEBAR_WIDTH_STYLE : undefined}
      data-testid="settings-sidebar"
    >
      {isDesktop ? (
        <View className="flex min-h-0 flex-1 flex-col">
          <View className="relative">''')
p.rep('''          <ScrollView
            style={sidebarStyles.scrollBody}
            showsVerticalScrollIndicator={false}
            testID="settings-sidebar-scroll-body"
          >
            {sidebarBody}
          </ScrollView>
        </View>
      ) : (
        sidebarBody
      )}
    </View>
  );''', '''          <div
            className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"
            data-testid="settings-sidebar-scroll-body"
          >
            {sidebarBody}
          </div>
        </View>
      ) : (
        sidebarBody
      )}
    </nav>
  );''')
p.rep('''// ---------------------------------------------------------------------------
// Main screen''', '''const SIDEBAR_WIDTH_STYLE = { width: SETTINGS_DESKTOP_SIDEBAR_WIDTH };

// ---------------------------------------------------------------------------
// Main screen''')

# ---------------------------------------------------------------- screen
p.rep('''  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
''', "")
p.rep('''      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t("settings.loading")}</Text>
      </View>''', '''      <View className="flex h-full flex-1 items-center justify-center bg-background">
        <Text className="text-sm text-foreground">{t("settings.loading")}</Text>
      </View>''')
SCROLL = '<div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">'
# A flex column, as React Native lays it out: section margins add up instead of collapsing.
CONTENT = '<View className="mx-auto flex w-full max-w-[720px] flex-col p-4 pt-6">'
p.rep('''      <View style={styles.container}>
        <BackHeader title={t("settings.title")} onBack={handleBackToWorkspace} />
        <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>''',
      f'''      <View className="flex h-full min-h-0 flex-1 flex-col bg-sidebar">
        <BackHeader title={{t("settings.title")}} onBack={{handleBackToWorkspace}} />
        {SCROLL}''')
p.rep('''            layout="mobile"
          />
        </ScrollView>''', '''            layout="mobile"
          />
        </div>''')
p.rep('''      <View style={[styles.container, styles.detailContainer]}>''',
      '''      <View className="flex h-full min-h-0 flex-1 flex-col bg-background">''')
p.rep('''        <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
          <View style={styles.content}>{content}</View>
        </ScrollView>
        {addHostModals}''', f'''        {SCROLL}
          {CONTENT}{{content}}</View>
        </div>
        {{addHostModals}}''')
p.rep('''    <View style={styles.container}>
      <View style={desktopStyles.row}>''', '''    <View className="flex h-full min-h-0 flex-1 flex-col bg-sidebar">
      <View className="flex min-h-0 flex-1 flex-row">''')
p.rep('''            leftStyle={desktopStyles.detailLeft}
          />
          <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
            <View style={styles.content}>{content}</View>
          </ScrollView>''', f'''            leftClassName="gap-2"
          />
          {SCROLL}
            {CONTENT}{{content}}</View>
          </div>''')

p.cut_from('''// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------''')
p.dom_tags()
p.check()
p.write("the settings sidebar, detail pane, General and About. Same logic, DOM view.",
        "settings-screen.py")
