"""Port packages/app's History page to web/src/overrides: screens/sessions-screen.tsx, the agent list
it renders (components/agent-list.tsx), and the two controls only that list uses
(components/ui/search-field.tsx, components/ui/highlighted-text.tsx). Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

# ---- highlighted-text.tsx
p = Port("components/ui/highlighted-text.tsx")
p.rep('''import { useMemo, type ReactElement } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
''', '''import { useMemo, type ReactElement } from "react";
import { cn } from "cn";
''')
p.rep('''  style?: StyleProp<TextStyle>;
  numberOfLines?: number;''', '''  className?: string;
  /** 1 truncates to one line with an ellipsis, as React Native's numberOfLines. */
  numberOfLines?: number;''')
p.rep('''  style,
  numberOfLines,
  testID,
}: HighlightedTextProps): ReactElement {''', '''  className,
  numberOfLines,
  testID,
}: HighlightedTextProps): ReactElement {
  // No line height of its own: tailwind-merge drops a leading-* that precedes the caller's text-*.
  const textClassName = cn(numberOfLines === 1 && "truncate", className);''')
p.rep('''      <Text style={style} numberOfLines={numberOfLines} testID={testID}>
        {text}
      </Text>''', '''      <span className={textClassName} data-testid={testID}>
        {text}
      </span>''')
p.rep('''    <Text style={style} numberOfLines={numberOfLines} testID={testID}>
      {segments.map((segment) =>
        segment.marked ? (
          <Text key={segment.start} style={styles.mark}>
            {segment.text}
          </Text>
        ) : (
          <Text key={segment.start}>{segment.text}</Text>
        ),
      )}
    </Text>''', '''    <span className={textClassName} data-testid={testID}>
      {segments.map((segment) =>
        segment.marked ? (
          <span key={segment.start} className="bg-(--surface-3) text-foreground">
            {segment.text}
          </span>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        ),
      )}
    </span>''')
p.cut_from("const styles = StyleSheet.create")
p.rep('''import { toHighlightSegments } from "./highlighted-text-segments";''',
      '''import { toHighlightSegments } from "@/components/ui/highlighted-text-segments";''')
p.check()
p.write("text with search matches marked; DOM view.", "sessions-screen.py")

# ---- search-field.tsx
p = Port("components/ui/search-field.tsx")
p.rep('''import { useCallback, useRef, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { Search, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";

const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  // Placeholders sit at foregroundMuted and no dimmer — see docs/design.md §14.
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
''', '''import { useCallback, useRef, type ReactElement } from "react";
import { Search, X } from "lucide-react";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
''')
p.rep('''  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleClear''', '''  const inputRef = useRef<EditingTextInputHandle>(null);
  const handleClear''')
# Chrome: controlFill behind a borderAccent border; on focus the ring border and the 3px ring.
p.rep('''    <View style={[styles.field, isFocused && styles.fieldFocused]}>
      <ThemedSearch size={14} uniProps={mutedColorMapping} />
      <ThemedTextInput
        testID={testID}
        ref={inputRef}
        initialValue={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />
      {value.length > 0 ? (
        <Pressable
          testID={clearTestID}
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          hitSlop={8}
        >
          <ThemedX size={14} uniProps={mutedColorMapping} />
        </Pressable>
      ) : null}
    </View>''', '''    <div className="flex max-w-[420px] min-w-0 flex-1 flex-row items-center gap-2 rounded-[10px] border border-input bg-background px-2.5 py-1.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:py-[5px] dark:bg-input/30">
      <Search size={14} className="shrink-0" />
      <TextInput
        testID={testID}
        ref={inputRef}
        initialValue={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        enterKeyHint="search"
        className="h-5 min-w-0 flex-1 bg-transparent p-0 text-sm leading-[normal] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {value.length > 0 ? (
        <button
          type="button"
          data-testid={clearTestID}
          onClick={handleClear}
          aria-label={clearAccessibilityLabel}
          // hitSlop 8, as packages/app's Pressable
          className="-m-2 flex shrink-0 p-2"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>''')
p.cut_from("const SEARCH_FIELD_MAX_WIDTH")
p.check()
p.write("the search box on a screen's filter row; DOM view.", "sessions-screen.py")

# ---- agent-list.tsx
p = Port("components/agent-list.tsx")
p.rep('''import {
  View,
  Text,
  Pressable,
  Modal,
  RefreshControl,
  FlatList,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
''', '''import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "cn";
''')
p.rep('''import { Archive, ChevronRight } from "lucide-react-native";''',
      '''import { Archive, ChevronRight } from "lucide-react";''')
# RefreshControl: React Native Web renders no pull-to-refresh, so the props stay for the API only.
p.rep('''export function AgentList({
  agents,
  isRefreshing = false,
  onRefresh,
  selectedAgentId,''', '''export function AgentList({
  agents,
  selectedAgentId,''')

p.rep('''function WorkspaceTitlePrefix({
  visible,
  workspaceName,
  ranges,
  testID,
  iconSize,
  color,
}: {
  visible: boolean;
  workspaceName: string;
  ranges?: readonly MatchRange[];
  testID: string;
  iconSize: number;
  color: string;
}) {''', '''function WorkspaceTitlePrefix({
  visible,
  workspaceName,
  ranges,
  testID,
}: {
  visible: boolean;
  workspaceName: string;
  ranges?: readonly MatchRange[];
  testID: string;
}) {''')
p.rep('''      <HighlightedText
        text={workspaceName}
        ranges={ranges}
        style={styles.workspaceTitleText}
        numberOfLines={1}
        testID={testID}
      />
      <ChevronRight size={iconSize} color={color} />''', '''      <HighlightedText
        text={workspaceName}
        ranges={ranges}
        className="max-w-[220px] shrink-0 text-sm leading-[normal] text-muted-foreground"
        numberOfLines={1}
        testID={testID}
      />
      <ChevronRight size={12} className="shrink-0 text-muted-foreground" />''')
p.rep('''    <View style={styles.rowTrailing}>
      <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
    </View>''', '''    <div className="ml-2 flex">
      <SessionBadge label={t("agentList.badges.attention")} tone="danger" />
    </div>''')

# Row. React Native Web's Pressable fires onLongPress after a 500ms hold (mouse or touch) and then
# skips the press; this is that, without the movement tolerance.
p.rep('''  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const timeAgo = formatTimeAgo(agent.lastActivityAt);''', '''  const { t } = useTranslation();
  const timeAgo = formatTimeAgo(agent.lastActivityAt);''')
p.rep('''  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      isSelected && styles.rowSelected,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isSelected],
  );

  const handlePress = useCallback(() => onPress(agent), [onPress, agent]);
  const handleLongPress = useCallback(() => onLongPress(agent), [onLongPress, agent]);

  const sessionTitleStyle = useMemo(
    () => [styles.sessionTitle, isSelected && styles.sessionTitleHighlighted],
    [isSelected],
  );

  const archivedIcon = useMemo(
    () => <Archive size={theme.fontSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.fontSize.sm, theme.colors.foregroundMuted],
  );''', '''  const longPressTimerRef = useRef<number | null>(null);
  const didLongPressRef = useRef(false);
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelLongPress, [cancelLongPress]);
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      cancelLongPress();
      didLongPressRef.current = false;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        didLongPressRef.current = true;
        onLongPress(agent);
      }, LONG_PRESS_MS);
    },
    [agent, cancelLongPress, onLongPress],
  );
  const handlePress = useCallback(() => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    onPress(agent);
  }, [onPress, agent]);

  const archivedIcon = useMemo(
    () => <Archive size={12} className="text-muted-foreground" />,
    [],
  );''')
p.rep('''    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      onLongPress={handleLongPress}
      testID={`agent-row-${agent.serverId}-${agent.id}`}
    >
      {isSelected ? (
        <View pointerEvents="none" aria-hidden style={styles.selectedIndicator} />
      ) : null}
      <View style={styles.rowContent}>
        <View style={styles.rowTitleRow}>
          <WorkspaceTitlePrefix
            visible={!isMobile && Boolean(workspaceName)}
            workspaceName={workspaceName}
            ranges={rangesFor("workspace")}
            testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
            iconSize={theme.iconSize.xs}
            color={theme.colors.foregroundMuted}
          />
          <View style={styles.providerIconWrap}>
            <ProviderIcon size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </View>
          <HighlightedText
            text={agent.title || t("agentList.fallbackTitle")}
            ranges={agent.title ? rangesFor("title") : undefined}
            style={sessionTitleStyle}
            numberOfLines={1}
          />''', '''    <button
      type="button"
      className={cn(
        "relative mb-0.5 flex w-full flex-row items-center overflow-hidden rounded-sm px-3 py-2 text-left select-none [-webkit-touch-callout:none] hover:bg-muted active:bg-muted",
        isSelected && "bg-muted",
      )}
      onClick={handlePress}
      onPointerDown={handlePointerDown}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      data-testid={`agent-row-${agent.serverId}-${agent.id}`}
    >
      {isSelected ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-foreground"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="flex flex-row flex-nowrap items-center gap-2 overflow-hidden">
          <WorkspaceTitlePrefix
            visible={!isMobile && Boolean(workspaceName)}
            workspaceName={workspaceName}
            ranges={rangesFor("workspace")}
            testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
          />
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            <ProviderIcon size={14} color="currentColor" />
          </span>
          <HighlightedText
            text={agent.title || t("agentList.fallbackTitle")}
            ranges={agent.title ? rangesFor("title") : undefined}
            className={cn(
              "min-w-0 shrink text-sm leading-[normal] font-normal text-foreground",
              isSelected ? "opacity-100" : "opacity-86",
            )}
            numberOfLines={1}
          />''')
p.between('''          />
        </View>
        {isMobile ? (
          <View style={styles.rowMetaRow}>''', '''      {!isMobile ? (
        <View style={styles.rowColumns}>''', '''          />
        </span>
        {isMobile ? (
          <SessionRowMetaLine
            agent={agent}
            projectName={projectName}
            branch={branch}
            workspaceName={workspaceName}
            timeAgo={timeAgo}
            showHostColumn={showHostColumn}
            rangesFor={rangesFor}
          />
        ) : null}
      </span>
''')
p.rep('''      {!isMobile ? (
        <View style={styles.rowColumns}>
          <HighlightedText
            text={projectName}
            ranges={rangesFor("project")}
            style={styles.columnMeta}
            numberOfLines={1}
            testID={`agent-row-project-${agent.serverId}-${agent.id}`}
          />
          {showHostColumn ? (
            <Text style={styles.columnMetaHost} numberOfLines={1}>
              {agent.serverLabel}
            </Text>
          ) : null}
          <HighlightedText
            text={branch}
            ranges={rangesFor("branch")}
            style={styles.columnMeta}
            numberOfLines={1}
            testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
          />
          <Text style={styles.columnMetaFixed} numberOfLines={1}>
            {timeAgo}
          </Text>
        </View>
      ) : null}''', '''      {!isMobile ? (
        <span className="flex shrink-0 flex-row items-center gap-3">
          <HighlightedText
            text={projectName}
            ranges={rangesFor("project")}
            className={COLUMN_META}
            numberOfLines={1}
            testID={`agent-row-project-${agent.serverId}-${agent.id}`}
          />
          {showHostColumn ? (
            <span className="ml-4 w-[120px] shrink-0 truncate text-right text-sm leading-[normal] text-muted-foreground">
              {agent.serverLabel}
            </span>
          ) : null}
          <HighlightedText
            text={branch}
            ranges={rangesFor("branch")}
            className={COLUMN_META}
            numberOfLines={1}
            testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
          />
          <span className="w-[72px] shrink-0 truncate text-right text-sm leading-[normal] text-muted-foreground">
            {timeAgo}
          </span>
        </span>
      ) : null}''')
# The mobile meta line, from packages/app's row: project · branch · workspace · time · host.
p.rep('''function SessionRow({''', '''function SessionRowMetaLine({
  agent,
  projectName,
  branch,
  workspaceName,
  timeAgo,
  showHostColumn,
  rangesFor,
}: {
  agent: AggregatedAgent;
  projectName: string;
  branch: string;
  workspaceName: string;
  timeAgo: string;
  showHostColumn: boolean;
  rangesFor: (field: AgentSearchMatch["field"]) => readonly MatchRange[] | undefined;
}) {
  return (
    <span className="mt-0.5 flex flex-row flex-wrap items-center gap-1">
      <HighlightedText
        text={projectName}
        ranges={rangesFor("project")}
        className={META_TEXT}
        numberOfLines={1}
        testID={`agent-row-project-${agent.serverId}-${agent.id}`}
      />
      <span className={META_SEPARATOR}>·</span>
      <HighlightedText
        text={branch}
        ranges={rangesFor("branch")}
        className={META_TEXT}
        numberOfLines={1}
        testID={`agent-row-branch-${agent.serverId}-${agent.id}`}
      />
      <span className={META_SEPARATOR}>·</span>
      <HighlightedText
        text={workspaceName}
        ranges={rangesFor("workspace")}
        className={META_TEXT}
        numberOfLines={1}
        testID={`agent-row-workspace-${agent.serverId}-${agent.id}`}
      />
      <span className={META_SEPARATOR}>·</span>
      <span className={META_TEXT}>{timeAgo}</span>
      {showHostColumn && agent.serverLabel ? (
        <>
          <span className={META_SEPARATOR}>·</span>
          <span className={cn(META_TEXT, "truncate")}>{agent.serverLabel}</span>
        </>
      ) : null}
    </span>
  );
}

function SessionRow({''')
p.rep('''        requiresAttention={agent.requiresAttention}
      />
    </Pressable>
  );
}''', '''        requiresAttention={agent.requiresAttention}
      />
    </button>
  );
}''')

# List
p.rep('''  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [actionAgent''', '''  const { t } = useTranslation();
  const [actionAgent''')
p.rep('''  const renderItem: ListRenderItem<FlatListItem> = useCallback(
    ({ item }) => {
      if (item.type === "header") {
        return (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>{formatDateSectionLabel(t, item.section)}</Text>
          </View>
        );
      }''', '''  const renderItem = useCallback(
    (item: FlatListItem) => {
      if (item.type === "header") {
        return (
          <div key={item.key} className="mt-2 mb-2 flex flex-row items-center gap-3 px-3">
            <span className="text-sm leading-[normal] font-medium text-muted-foreground">
              {formatDateSectionLabel(t, item.section)}
            </span>
          </div>
        );
      }''')
p.rep('''        <SessionRow
          agent={item.agent}''', '''        <SessionRow
          key={item.key}
          agent={item.agent}''')
p.between('''  const keyExtractor = useCallback((item: FlatListItem) => item.key, []);
''', '''  return (
    <>''', "")
# packages/app's fading Modal: the dialog is the whole overlay, with a tap-to-close backdrop behind a
# sheet pinned to the bottom.
p.rep('''export function AgentList({''', '''function ArchiveActionSheet({
  open,
  title,
  archiveDisabled,
  onClose,
  onArchive,
}: {
  open: boolean;
  title: string;
  archiveDisabled: boolean;
  onClose: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col justify-end outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <div className="absolute inset-0 bg-black/35" onClick={onClose} />
          <div className="relative flex flex-col gap-4 rounded-t-[16px] bg-muted px-6 pt-4 pb-[max(env(safe-area-inset-bottom),24px)]">
            <div className="h-1 w-10 self-center rounded-full bg-muted-foreground opacity-30" />
            <DialogPrimitive.Title className="text-center text-sm leading-[normal] font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
            <div className="flex flex-row gap-3">
              <button
                type="button"
                className="flex flex-1 items-center justify-center rounded-[10px] bg-card py-4 text-sm leading-[normal] font-semibold text-foreground"
                onClick={onClose}
                data-testid="agent-action-cancel"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                disabled={archiveDisabled}
                className="flex flex-1 items-center justify-center rounded-[10px] bg-primary py-4 text-sm leading-[normal] font-semibold text-primary-foreground disabled:text-primary-foreground/50"
                onClick={onArchive}
                data-testid="agent-action-archive"
              >
                {t("agentList.archiveSheet.archive")}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function AgentList({''')
p.rep('''      <FlatList
        data={flatItems}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={listFooterComponent}
        refreshControl={refreshControl}
      />

      <Modal
        visible={isActionSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={handleCloseActionSheet}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={handleCloseActionSheet} />
          <View style={sheetContainerStyle}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {isActionDaemonUnavailable
                ? t("agentList.archiveSheet.hostOffline")
                : t("agentList.archiveSheet.runningAgent")}
            </Text>
            <View style={styles.sheetButtonRow}>
              <Pressable
                style={[styles.sheetButton, styles.sheetCancelButton]}
                onPress={handleCloseActionSheet}
                testID="agent-action-cancel"
              >
                <Text style={styles.sheetCancelText}>{t("common.actions.cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={isActionDaemonUnavailable}
                style={[styles.sheetButton, styles.sheetArchiveButton]}
                onPress={handleArchiveAgent}
                testID="agent-action-archive"
              >
                <Text style={sheetArchiveTextStyle}>{t("agentList.archiveSheet.archive")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>''', '''      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        <div className="flex flex-col gap-1 px-3 pt-4 pb-6 md:px-6">
          {flatItems.map(renderItem)}
          {listFooterComponent}
        </div>
      </div>

      <ArchiveActionSheet
        open={isActionSheetVisible}
        title={
          isActionDaemonUnavailable
            ? t("agentList.archiveSheet.hostOffline")
            : t("agentList.archiveSheet.runningAgent")
        }
        archiveDisabled={isActionDaemonUnavailable}
        onClose={handleCloseActionSheet}
        onArchive={handleArchiveAgent}
      />''')
p.rep('''type FlatListItem =''', '''const LONG_PRESS_MS = 500;
const META_TEXT = "max-w-full text-sm leading-[normal] text-muted-foreground";
const META_SEPARATOR = "text-sm leading-[normal] text-muted-foreground opacity-70";
const COLUMN_META = "w-[132px] shrink-0 text-sm leading-[normal] text-muted-foreground";

type FlatListItem =''')
p.rep('''  showCheckoutInfo?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;''', '''  showCheckoutInfo?: boolean;
  /** packages/app's pull-to-refresh; React Native Web renders none, so the web list ignores them. */
  isRefreshing?: boolean;
  onRefresh?: () => void;''')
p.cut_from("const styles = StyleSheet.create")
p.check()
p.write("the History list (day sections, search marks, long press to archive); DOM view.",
        "sessions-screen.py")

# ---- sessions-screen.tsx
p = Port("screens/sessions-screen.tsx")
p.rep('''import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, Import } from "lucide-react-native";''', '''import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { ChevronLeft, Import } from "lucide-react";''')
p.rep('''    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>''', '''    <div className="px-3 pt-3 md:px-6">
      <div
        className="flex flex-col gap-1 rounded-[10px] border p-3"
        data-testid="sessions-host-errors"
      >
        {errors.map((error) => (
          <span key={error.serverId} className="text-xs leading-[normal] text-red-300">
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </span>
        ))}
      </div>
    </div>''')
p.rep('''    return <View style={styles.container} />;''', '''    return <div className={CONTAINER} />;''')
p.rep('''function SessionsScreenContent() {
  const { theme } = useUnistyles();
  const { t }''', '''function SessionsScreenContent() {
  const { t }''')
p.rep('''        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>''', '''        <div className="flex flex-col items-center py-4">
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("sessions.tooManyMatches")}
          </span>
        </div>''')
p.rep('''      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>''', '''      <div className="flex flex-col items-center py-4">
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </div>''')
p.rep('''    <View style={styles.container}>
      <MenuHeader title={t("sessions.title")} />
      {showFilterRow ? (
        <View style={styles.filterContainer}>''', '''    <div className={CONTAINER}>
      <MenuHeader title={t("sessions.title")} />
      {showFilterRow ? (
        <div className="flex flex-row items-center gap-2 px-3 pt-4 md:px-6">''')
p.rep('''              hostOptionTestID={sessionsHostOptionTestID}
            />
          ) : null}
        </View>
      ) : null}''', '''              hostOptionTestID={sessionsHostOptionTestID}
            />
          ) : null}
        </div>
      ) : null}''')
p.rep('''        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
        </View>''', '''        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <LoadingSpinner size="large" />
        </div>''')
p.rep('''        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Unable to load sessions</Text>
          <Button variant="ghost" onPress={handleRefresh}>
            Try again
          </Button>
        </View>''', '''        <div className={EMPTY_CONTAINER}>
          <span className={EMPTY_TEXT}>Unable to load sessions</span>
          <Button variant="ghost" onPress={handleRefresh}>
            Try again
          </Button>
        </div>''')
p.rep('''        <View style={styles.emptyContainer} testID="sessions-empty">
          <Text style={styles.emptyText}>{emptyText}</Text>''', '''        <div className={EMPTY_CONTAINER} data-testid="sessions-empty">
          <span className={EMPTY_TEXT}>{emptyText}</span>''')
p.rep('''            {t("importSession.title")}
          </Button>
        </View>
      ) : null}''', '''            {t("importSession.title")}
          </Button>
        </div>
      ) : null}''')
p.rep('''      {importSession.sheet}
    </View>
  );
}''', '''      {importSession.sheet}
    </div>
  );
}''')
p.cut_from("const styles = StyleSheet.create")
p.s += '''
const CONTAINER = "flex min-h-0 flex-1 flex-col bg-background";
const EMPTY_CONTAINER = "flex flex-1 flex-col items-center justify-center gap-6 p-6";
const EMPTY_TEXT = "text-sm leading-[normal] text-muted-foreground";
'''
p.check()
p.write("the History page; DOM view.", "sessions-screen.py")
