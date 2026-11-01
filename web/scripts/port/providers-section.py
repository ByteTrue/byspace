"""Port packages/app's screens/settings/providers-section.tsx to web/src/overrides: the provider
list and the add-provider catalog section of a host's Agents page. Same logic, DOM + Tailwind
view. A provider row is a clickable row holding a switch and a menu, so the row is a div with a
click handler and its trailing controls stop the click from reaching it."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

TEXT_MUTED = "text-sm leading-[normal] text-muted-foreground"

p = Port("screens/settings/providers-section.tsx")
p.rep('''import { useCallback, useMemo, useRef, useState } from "react";''',
      '''import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";''')
p.rep('''import {
  Alert,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";''', '''import { Alert } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { cn } from "cn";''')
p.rep('import { ChevronRight, MoreHorizontal, Trash2 } from "lucide-react-native";',
      'import { ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";')
p.rep('''function stopPressInPropagation(event: GestureResponderEvent) {
  event.stopPropagation();
}''', '''// The row opens the provider's settings; its switch and menu must not.
function stopClickPropagation(event: MouseEvent) {
  event.stopPropagation();
}

const SECTION_SPACING = { marginBottom: 16 };
const ADD_PROVIDER_SPACING = { marginTop: 16 };''')

# ---- actions menu ----
p.rep('''  const triggerStyle = useCallback(
    ({
      pressed,
      hovered,
      open,
    }: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) => [
      styles.menuButton,
      (hovered || open) && styles.menuButtonHovered,
      pressed && styles.menuButtonPressed,
    ],
    [],
  );
''', "")
p.rep('''        disabled={isRemoving}
        hitSlop={8}
        onPressIn={stopPressInPropagation}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel''', '''        disabled={isRemoving}
        className="flex size-8 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-(--surface-3) data-[state=open]:bg-muted"
        accessibilityLabel''')

# ---- provider row ----
# Enter and Space on the focused row press it, as on packages/app's Pressable.
p.rep('''  const handlePress = useCallback(() => {
    onPress(def.id);
  }, [def.id, onPress]);''', '''  const handlePress = useCallback(() => {
    onPress(def.id);
  }, [def.id, onPress]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }
      event.preventDefault();
      handlePress();
    },
    [handlePress],
  );''')
p.rep('''  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      styles.row,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );
''', "")
p.between('''  return (
    <Pressable
      style={rowStyle}''', '''function getDotColor(''', '''  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        settingsStyles.row,
        !isFirst && settingsStyles.rowBorder,
        "group/provider min-h-14 cursor-pointer gap-3 outline-none hover:bg-muted focus-visible:bg-muted active:bg-(--surface-3)",
      )}
      onClick={handlePress}
      onKeyDown={handleKeyDown}
      aria-label={t("settings.providers.providerDetails", { name: def.label })}
    >
      <div className="flex flex-1 flex-row items-center gap-2">
        <ChevronRight
          size={theme.iconSize.sm}
          className="shrink-0 text-muted-foreground group-hover/provider:text-foreground"
        />
        <ProviderIcon size={theme.iconSize.md} color={theme.colors.foreground} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-row items-center gap-2">
            <span className={cn(settingsStyles.rowTitle, "truncate")}>{def.label}</span>
            {!isCompact ? <span className="''' + TEXT_MUTED + '''">·</span> : null}
            <StatusIndicator status={providerStatus} compact={isCompact} />
          </div>
          {providerError && !isCompact ? (
            <span className="mt-1 line-clamp-3 text-xs leading-[normal] text-red-300">
              {providerError}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-row items-center gap-1" onClick={stopClickPropagation}>
        <Switch
          value={enabled}
          onValueChange={handleToggleValueChange}
          disabled={isToggling || isRemoving}
          accessibilityLabel={t("settings.providers.enableProvider", { name: def.label })}
        />
        <div className="size-8">
          {canRemove ? (
            <ProviderActionsMenu
              providerId={def.id}
              providerLabel={def.label}
              isRemoving={isRemoving}
              iconSize={theme.iconSize.sm}
              foregroundColor={theme.colors.foreground}
              foregroundMutedColor={theme.colors.foregroundMuted}
              dangerColor={theme.colors.statusDanger}
              onRemove={onRemove}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

''')

# ---- status indicator ----
p.rep('''  const dotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: getDotColor(status.tone, theme) }],
    [status.tone, theme],
  );''', '''  const dotStyle = useMemo(
    () => ({ backgroundColor: getDotColor(status.tone, theme) }),
    [status.tone, theme],
  );''')
p.rep('''    <View style={styles.statusRow}>
      {status.tone === "loading" ? (
        <LoadingSpinner size={10} color={theme.colors.foregroundMuted} />
      ) : (
        <View style={dotStyle} />
      )}
      {!compact ? (
        <>
          <Text style={styles.statusLabel}>{status.label}</Text>
          {status.modelCount !== null ? (
            <>
              <Text style={styles.separator}>·</Text>
              <Text style={styles.statusLabel}>''', f'''    <div className="flex flex-row items-center gap-1.5">
      {{status.tone === "loading" ? (
        <LoadingSpinner size={{10}} color={{theme.colors.foregroundMuted}} />
      ) : (
        <span className="size-2 shrink-0 rounded-full" style={{dotStyle}} />
      )}}
      {{!compact ? (
        <>
          <span className="{TEXT_MUTED}">{{status.label}}</span>
          {{status.modelCount !== null ? (
            <>
              <span className="{TEXT_MUTED}">·</span>
              <span className="{TEXT_MUTED}">''')
p.rep('''                  : t("settings.providers.models.many", { count: status.modelCount })}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>''', '''                  : t("settings.providers.models.many", { count: status.modelCount })}
              </span>
            </>
          ) : null}
        </>
      ) : null}
    </div>''')

# ---- sections ----
p.rep('''      style={styles.sectionSpacing}''', '''      style={SECTION_SPACING}''')
p.rep('''      style={styles.addProviderSection}''', '''      style={ADD_PROVIDER_SPACING}''')
for key in ("unavailable", "loading"):
    p.rep(f'''        <View style={{[settingsStyles.card, styles.emptyCard]}}>
          <Text style={{styles.emptyText}}>{{t("settings.providers.{key}")}}</Text>
        </View>''', f'''        <div className={{cn(settingsStyles.card, "items-center p-4")}}>
          <span className="{TEXT_MUTED}">{{t("settings.providers.{key}")}}</span>
        </div>''')
p.rep('''        <View style={settingsStyles.card}>
          {providerDefinitions.map(''', '''        <div className={settingsStyles.card}>
          {providerDefinitions.map(''')
p.rep('''          })}
        </View>
      ) : null}
    </SettingsSection>''', '''          })}
        </div>
      ) : null}
    </SettingsSection>''')
p.cut_from("const styles = StyleSheet.create")
p.check(allow=('react-native"',))
p.write("the provider list and the add-provider section; DOM view.", "providers-section.py")
