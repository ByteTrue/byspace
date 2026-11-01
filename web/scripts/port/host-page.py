"""Port packages/app's screens/settings/host-page.tsx to web/src/overrides: the Host, Connections,
Agents and Usage pages of a host's settings. Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

EMPTY_TEXT = "text-sm leading-[normal] text-muted-foreground"
CONFIRM_TEXT = "block text-sm leading-[normal] text-muted-foreground"
CONFIRM_ACTIONS = "mt-4 flex flex-row items-center justify-end gap-2"

p = Port("screens/settings/host-page.tsx")
p.rep('import { Alert, Pressable, Text, View } from "react-native";\n', 'import { Alert } from "react-native";\n')
p.rep('import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";\n',
      'import { useUnistyles, withUnistyles } from "react-native-unistyles";\nimport { cn } from "cn";\n')
p.rep('} from "lucide-react-native";', '} from "lucide-react";')
# an override's relative imports do not reach packages/app
p.rep('from "./daemon-reconnect";', 'from "@/screens/settings/daemon-reconnect";')
p.rep('from "./daemon-restart";', 'from "@/screens/settings/daemon-restart";')

# ---- not found / unavailable cards ----
p.rep('''    <View>
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.host.notFound")}</Text>
      </View>
    </View>''', f'''    <div className="flex flex-col">
      <div className={{cn(settingsStyles.card, "items-center p-4")}}>
        <span className="{EMPTY_TEXT}">{{t("settings.host.notFound")}}</span>
      </div>
    </div>''')
p.rep('''        <View style={[settingsStyles.card, styles.emptyCard]}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>''', f'''        <div className={{cn(settingsStyles.card, "items-center p-4")}}>
          <span className="{EMPTY_TEXT}">{{t("settings.host.agents.unavailable")}}</span>
        </div>''')

# ---- status badges ----
p.rep('''  const statusDotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: statusDotColor }],
    [statusDotColor],
  );
  const statusLeading = useMemo(() => <View style={statusDotStyle} />, [statusDotStyle]);''',
      '''  const statusDotStyle = useMemo(() => ({ backgroundColor: statusDotColor }), [statusDotColor]);
  const statusLeading = useMemo(
    () => <span className="size-1.5 shrink-0 rounded-full" style={statusDotStyle} />,
    [statusDotStyle],
  );''')
BADGE_PILL = "flex max-w-[200px] flex-row items-center gap-1.5 rounded-sm border bg-muted px-2 py-0.5"
# The Expo styles ask for the mono font here, but packages/app's root font rule
# (appearance/apply-root-font.web.ts) gives every text outside a data-pmono subtree the UI font.
BADGE_TEXT = "shrink truncate text-xs leading-[normal] font-normal text-muted-foreground"
p.rep('''    <View style={styles.identityBadges} testID="host-page-identity">''',
      '''    <div className="mb-6 flex flex-row flex-wrap items-center gap-1" data-testid="host-page-identity">''')
p.rep('''        <View style={styles.badgePill}>
          {connectionBadge.icon}
          <Text style={styles.badgeText} numberOfLines={1}>
            {connectionBadge.text}
          </Text>
        </View>''', f'''        <div className="{BADGE_PILL}">
          {{connectionBadge.icon}}
          <span className="{BADGE_TEXT}">{{connectionBadge.text}}</span>
        </div>''')
p.rep('''        <View style={styles.badgePill}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {versionBadgeText}
          </Text>
        </View>''', f'''        <div className="{BADGE_PILL}">
          <span className="{BADGE_TEXT}">{{versionBadgeText}}</span>
        </div>''')
p.rep('''  return <Text style={styles.errorText}>{connectionError}</Text>;''',
      '''  return (
    <span className="mb-2 block text-xs leading-[normal] text-red-300">{connectionError}</span>
  );''')

# ---- host page header ----
p.rep('''      <View style={styles.daemonHeader}>
        <Text style={styles.daemonHeaderLabel} numberOfLines={1}>
          {host.label}
        </Text>
      </View>''', '''      <div className="mb-4 flex flex-row items-center gap-1">
        <span className="shrink truncate text-base leading-[normal] font-medium text-foreground">
          {host.label}
        </span>
      </div>''')

# ---- confirm sheets ----
p.rep('''          <Text style={styles.confirmText}>
            {t("settings.host.connections.removeMessage", {
              name: pendingRemoveConnection.title,
            })}
          </Text>
          <View style={styles.confirmActions}>''', f'''          <span className="{CONFIRM_TEXT}">
            {{t("settings.host.connections.removeMessage", {{
              name: pendingRemoveConnection.title,
            }})}}
          </span>
          <div className="{CONFIRM_ACTIONS}">''')
p.rep('''          <Text style={styles.confirmText}>
            {isServingDaemon
              ? t("settings.host.daemon.remove.localConfirmMessage")
              : t("settings.host.daemon.remove.confirmMessage", { name: host.label })}
          </Text>
          <View style={styles.confirmActions}>''', f'''          <span className="{CONFIRM_TEXT}">
            {{isServingDaemon
              ? t("settings.host.daemon.remove.localConfirmMessage")
              : t("settings.host.daemon.remove.confirmMessage", {{ name: host.label }})}}
          </span>
          <div className="{CONFIRM_ACTIONS}">''')

# ---- connection row ----
p.rep('''  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const latencyTextStyle = useMemo(
    () => [styles.connectionLatency, { color: latencyColor }],
    [latencyColor],
  );
  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );
''', '''  const latencyTextStyle = useMemo(() => ({ color: latencyColor }), [latencyColor]);
''')
p.rep('''    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={latencyTextStyle}>{latencyText}</Text>
      <Button
        variant="ghost"
        size="sm"
        textStyle={destructiveTextStyle}''', '''    <div className={cn(settingsStyles.row, showBorder && settingsStyles.rowBorder)}>
      <div className={settingsStyles.rowContent}>
        <span className={cn(settingsStyles.rowTitle, "truncate")}>{title}</span>
      </div>
      <span className="mr-2 text-sm leading-[normal]" style={latencyTextStyle}>
        {latencyText}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"''')

# ---- update failure ----
p.rep('''        <View style={styles.updateFailure}>''', '''        <div className="mx-4 mb-4">''')

# ---- append system prompt actions ----
p.rep('''          <View style={styles.appendPromptActions}>''', '''          <div className="flex flex-row justify-end gap-2">''')

# ---- pair device row: the whole row is the button ----
p.rep('''      <Pressable
        style={settingsStyles.row}
        onPress={handleOpen}
        accessibilityRole="button"
        testID="host-page-pair-device-row"
      >''', '''      <button
        type="button"
        className={cn(settingsStyles.row, "w-full text-left")}
        onClick={handleOpen}
        data-testid="host-page-pair-device-row"
      >''')
p.rep('''        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>''', '''        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </button>''')

# ---- remove host ----
p.rep('''  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  const handleOpenConfirm''', '''  const handleOpenConfirm''')
p.rep('''            leftIcon={removeIcon}
            textStyle={destructiveTextStyle}''', '''            leftIcon={removeIcon}
            className="text-destructive"''')

# ---- terminal profiles ----
p.rep('''  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder, terminalProfileStyles.row],
    [isFirst],
  );
''', "")
p.rep('''    <View style={rowStyle} testID={`terminal-profile-row-${profile.id}`}>
      <View style={terminalProfileStyles.iconWrapper}>''', '''    <div
      className={cn(settingsStyles.row, !isFirst && settingsStyles.rowBorder, "min-h-14 gap-2")}
      data-testid={`terminal-profile-row-${profile.id}`}
    >
      <div className="flex w-4 items-center justify-center">''')
p.rep('''      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {profile.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {commandText}
        </Text>
      </View>
      <View style={terminalProfileStyles.rowActions}>''', '''      <div className={settingsStyles.rowContent}>
        <span className={cn(settingsStyles.rowTitle, "truncate")}>{profile.name}</span>
        <span className={cn(settingsStyles.rowHint, "truncate")}>{commandText}</span>
      </div>
      <div className="flex flex-row items-center gap-0">''')
p.rep('''      <View style={settingsStyles.card} testID="terminal-profiles-unavailable">
        <View style={terminalProfileStyles.emptyCard}>
          <Text style={terminalProfileStyles.emptyText}>
            {t("settings.host.terminalProfiles.unavailable")}
          </Text>
        </View>
      </View>''', f'''      <div className={{settingsStyles.card}} data-testid="terminal-profiles-unavailable">
        <div className="flex flex-col items-center p-4">
          <span className="{EMPTY_TEXT} text-center">
            {{t("settings.host.terminalProfiles.unavailable")}}
          </span>
        </div>
      </div>''')
p.rep('''            <View style={terminalProfileStyles.emptyCard}>
              <Text style={terminalProfileStyles.emptyText}>
                {t("settings.host.terminalProfiles.emptyState")}
              </Text>
            </View>''', f'''            <div className="flex flex-col items-center p-4">
              <span className="{EMPTY_TEXT} text-center">
                {{t("settings.host.terminalProfiles.emptyState")}}
              </span>
            </div>''')

# A View is a flex column; as a plain div, the Agents page's sections would collapse their margins.
p.rep("    <View>\n", '    <div className="flex flex-col">\n', 4)
p.dom_tags()
p.dom_attrs()
p.cut_from("const terminalProfileStyles = StyleSheet.create")
p.check(allow=('react-native"',))
p.write("a host's Host, Connections, Agents and Usage pages; DOM view.", "host-page.py")
