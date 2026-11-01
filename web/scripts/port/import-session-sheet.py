"""Port packages/app's components/import-session-sheet.tsx to web/src/overrides: import a provider
session started outside BySpace (recent sessions per provider, search, provider filter, manual
import by session id). The queries, the import mutation and the view model are the Expo file's;
the view is DOM + Tailwind."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

p = Port("components/import-session-sheet.tsx")
p.rep('''import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
''', '''import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
''')
p.rep('''import { ChevronDown, Inbox, Layers, RotateCw } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
''', '''import { ChevronDown, Inbox, Layers, RotateCw } from "lucide-react";
''')
p.rep('''const DISABLED_ACCESSIBILITY_STATE = { disabled: true };
''', "")

# Status messages
p.rep('''  const { theme } = useUnistyles();
  const { t } = useTranslation();
  if (!isClientReady) {
    return <Text style={styles.statusText}>{t("importSession.status.connectHost")}</Text>;
  }
  if (isSnapshotUnsupported) {
    return <Text style={styles.statusText}>{t("importSession.status.updateHost")}</Text>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <Text style={styles.statusText}>{t("importSession.status.noProviders")}</Text>
      ) : null}
      {isLoadingSessions && !hasRows ? (
        <View style={styles.statusRow}>
          <LoadingSpinner color={theme.colors.foregroundMuted} />
          <Text style={styles.statusText}>{t("importSession.status.loading")}</Text>
        </View>
      ) : null}
      {importErrorMessage !== null ? (
        <Text style={styles.statusText}>
          {t("importSession.status.failedImport")}
          {importErrorMessage ? ` [${importErrorMessage}]` : ""}
        </Text>
      ) : null}
    </>
  );''', '''  const { t } = useTranslation();
  if (!isClientReady) {
    return <span className={STATUS_TEXT}>{t("importSession.status.connectHost")}</span>;
  }
  if (isSnapshotUnsupported) {
    return <span className={STATUS_TEXT}>{t("importSession.status.updateHost")}</span>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <span className={STATUS_TEXT}>{t("importSession.status.noProviders")}</span>
      ) : null}
      {isLoadingSessions && !hasRows ? (
        <div className="flex flex-row items-center gap-2 py-2 text-muted-foreground">
          <LoadingSpinner />
          <span className={STATUS_TEXT}>{t("importSession.status.loading")}</span>
        </div>
      ) : null}
      {importErrorMessage !== null ? (
        <span className={STATUS_TEXT}>
          {t("importSession.status.failedImport")}
          {importErrorMessage ? ` [${importErrorMessage}]` : ""}
        </span>
      ) : null}
    </>
  );''')

# Provider error banner
p.rep('''    <View style={styles.errorBanner} testID="import-session-provider-errors">
      {rows.map((row) => (
        <ProviderErrorBannerRow key={row.provider} row={row} onRetry={onRetry} />
      ))}
    </View>''', '''    <div
      className="mb-2 flex flex-col rounded-[10px] border px-3 py-1"
      data-testid="import-session-provider-errors"
    >
      {rows.map((row) => (
        <ProviderErrorBannerRow key={row.provider} row={row} onRetry={onRetry} />
      ))}
    </div>''')
p.rep('''    <View style={styles.errorRow}>
      <Text style={styles.errorText}>
        {t("importSession.status.failedProvider", { provider: row.label })}
      </Text>''', '''    <div className="flex flex-row items-center justify-between gap-2">
      <span className="min-w-0 shrink text-xs leading-[normal] text-red-300">
        {t("importSession.status.failedProvider", { provider: row.label })}
      </span>''')
p.rep('''        {t("common.actions.retry")}
      </Button>
    </View>
  );
}''', '''        {t("common.actions.retry")}
      </Button>
    </div>
  );
}''')

# Refresh action
p.rep('''function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.refreshButton,
      pressed && styles.refreshButtonPressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={isRefreshing}
      accessibilityLabel={t("importSession.actions.refresh")}
      accessibilityRole="button"
      testID="import-session-refresh"
      style={pressableStyle}
    >
      <View style={styles.refreshIconSlot}>
        {isRefreshing ? (
          <LoadingSpinner color={theme.colors.foregroundMuted} />
        ) : (
          <RotateCw size={16} color={theme.colors.foregroundMuted} />
        )}
      </View>
    </Pressable>
  );
}''', '''function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={isRefreshing}
      aria-label={t("importSession.actions.refresh")}
      data-testid="import-session-refresh"
      className="mr-1 rounded-[10px] p-2 text-muted-foreground active:bg-muted"
    >
      <span className="flex size-4 items-center justify-center">
        {isRefreshing ? <LoadingSpinner /> : <RotateCw size={16} />}
      </span>
    </button>
  );
}''')

# Scope subtitle
p.rep('''    <View style={styles.subtitleRow}>
      <Text style={styles.subtitleText} numberOfLines={1} testID="import-session-scope">
        {isScoped
          ? t("importSession.scope.workspace")
          : t("importSession.scope.host", { host: hostLabel })}
      </Text>''', '''    <div className="flex min-w-0 flex-row items-center gap-2">
      <span
        className="min-w-0 shrink truncate text-xs leading-[normal] text-muted-foreground"
        data-testid="import-session-scope"
      >
        {isScoped
          ? t("importSession.scope.workspace")
          : t("importSession.scope.host", { host: hostLabel })}
      </span>''')
p.rep('''          testID="import-session-show-all"
          style={styles.subtitleAction}
        >
          {t("importSession.actions.showAll")}
        </Button>
      ) : null}
    </View>
  );
}''', '''          testID="import-session-show-all"
          className="-mx-2"
        >
          {t("importSession.actions.showAll")}
        </Button>
      ) : null}
    </div>
  );
}''')

# Empty state
p.rep('''function SheetEmptyState({ title }: { title: string }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.emptyState} testID="import-session-empty-state">
      <View style={styles.emptyStateIcon}>
        <Inbox size={theme.iconSize.lg} color={theme.colors.foregroundMuted} strokeWidth={1.5} />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
    </View>
  );
}''', '''function SheetEmptyState({ title }: { title: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 px-4 py-8"
      data-testid="import-session-empty-state"
    >
      <div className="mb-1 text-muted-foreground opacity-60">
        <Inbox size={20} strokeWidth={1.5} />
      </div>
      <span className="text-center text-sm leading-[normal] text-foreground">{title}</span>
    </div>
  );
}''')

# Row
p.rep('''  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const title = getSessionTitle(entry);''', '''  const { t } = useTranslation();
  const title = getSessionTitle(entry);''')
p.rep('''  const accessibilityState = useMemo(
    () => (disabled ? DISABLED_ACCESSIBILITY_STATE : undefined),
    [disabled],
  );
  const handlePress = useCallback(() => {
    onImportSession(entry);
  }, [entry, onImportSession]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={pressableStyle}
      testID={`import-session-session-${entry.providerId}-${entry.providerHandleId}`}
    >
      <View style={styles.rowIconWrap}>
        <ProviderIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta}>
            {importing ? t("importSession.row.importing") : lastActivity}
          </Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {promptPreview}
        </Text>
        {folder ? (
          <Text
            style={styles.rowFolder}
            numberOfLines={1}
            testID={`import-session-row-folder-${entry.providerId}-${entry.providerHandleId}`}
          >
            {folder}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );''', '''  const handlePress = useCallback(() => {
    onImportSession(entry);
  }, [entry, onImportSession]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handlePress}
      className="-mx-2 flex flex-row items-start gap-2 rounded-[10px] p-2 text-left enabled:hover:bg-card enabled:active:bg-muted"
      data-testid={`import-session-session-${entry.providerId}-${entry.providerHandleId}`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center pt-0.5 text-muted-foreground">
        <ProviderIcon size={16} color="currentColor" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-row items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-[normal] text-foreground">
            {title}
          </span>
          <span className="shrink-0 text-xs leading-[normal] text-muted-foreground">
            {importing ? t("importSession.row.importing") : lastActivity}
          </span>
        </span>
        <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">
          {promptPreview}
        </span>
        {folder ? (
          <span
            className="truncate text-xs leading-[normal] text-muted-foreground"
            data-testid={`import-session-row-folder-${entry.providerId}-${entry.providerHandleId}`}
          >
            {folder}
          </span>
        ) : null}
      </span>
    </button>
  );''')

# Manual form
p.rep('''    <View style={styles.manualForm} testID="import-session-manual-form">''',
      '''    <div className="flex flex-col gap-3 pb-4" data-testid="import-session-manual-form">''')
p.rep('''        {isPending ? t("importSession.row.importing") : t("importSession.title")}
      </Button>
    </View>
  );
}''', '''        {isPending ? t("importSession.row.importing") : t("importSession.title")}
      </Button>
    </div>
  );
}''')
p.rep('''    <View style={styles.list}>
      {entries.map((entry) => (''', '''    <div className="flex flex-col gap-1">
      {entries.map((entry) => (''')
p.rep('''          onImportSession={onImportSession}
        />
      ))}
    </View>
  );
}''', '''          onImportSession={onImportSession}
        />
      ))}
    </div>
  );
}''')

# Sheet body
p.rep('''  const queryClient = useQueryClient();
  const { theme } = useUnistyles();
  const formControlSize''', '''  const queryClient = useQueryClient();
  const formControlSize''')
p.rep('''  const filterAnchorRef = useRef<View>(null);''', '''  const filterAnchorRef = useRef<HTMLDivElement | null>(null);''')
p.rep('''  const filterTriggerStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.filterTrigger,
      Boolean(hovered) && styles.filterTriggerHovered,
      pressed && styles.filterTriggerPressed,
    ],
    [],
  );

''', "")
p.rep('''    const ProviderIcon = getProviderIcon(manualProvider);
    return <ProviderIcon size={14} color={theme.colors.foregroundMuted} />;
  }, [manualProvider, theme.colors.foregroundMuted]);''', '''    const ProviderIcon = getProviderIcon(manualProvider);
    return (
      <span className="flex text-muted-foreground">
        <ProviderIcon size={14} color="currentColor" />
      </span>
    );
  }, [manualProvider]);''')
p.rep('''    map.set(ALL_FILTER_VALUE, <Layers size={14} color={theme.colors.foregroundMuted} />);
    for (const provider of filterProviders) {
      const ProviderIcon = getProviderIcon(provider, serverId);
      map.set(provider, <ProviderIcon size={14} color={theme.colors.foregroundMuted} />);
    }
    return map;
  }, [filterProviders, serverId, theme.colors.foregroundMuted]);''', '''    map.set(ALL_FILTER_VALUE, <Layers size={14} className="text-muted-foreground" />);
    for (const provider of filterProviders) {
      const ProviderIcon = getProviderIcon(provider, serverId);
      map.set(
        provider,
        <span className="flex text-muted-foreground">
          <ProviderIcon size={14} color="currentColor" />
        </span>,
      );
    }
    return map;
  }, [filterProviders, serverId]);''')
p.rep('''        <View ref={filterAnchorRef} collapsable={false} style={styles.filterTriggerWrap}>
          <Pressable
            onPress={handleFilterOpen}
            style={filterTriggerStyle}
            testID="import-session-filter-trigger"
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${selectedProviderLabel}`}
          >
            {selectedProvider === ALL_FILTER_VALUE ? (
              <Layers size={14} color={theme.colors.foregroundMuted} />
            ) : (
              (() => {
                const ProviderIcon = getProviderIcon(selectedProvider, serverId);
                return <ProviderIcon size={14} color={theme.colors.foregroundMuted} />;
              })()
            )}
            <Text style={styles.filterTriggerText} numberOfLines={1}>
              {selectedProviderLabel}
            </Text>
            <ChevronDown size={14} color={theme.colors.foregroundMuted} />
          </Pressable>''', '''        <div ref={filterAnchorRef} className="flex flex-col pb-2">
          <button
            type="button"
            onClick={handleFilterOpen}
            className="flex max-w-full flex-row items-center gap-1.5 self-start rounded-lg border bg-card px-3 py-1.5 text-muted-foreground hover:bg-muted active:bg-(--surface-3)"
            data-testid="import-session-filter-trigger"
            aria-label={`Filter: ${selectedProviderLabel}`}
          >
            {filterOptionIcons.get(selectedProvider)}
            <span className="min-w-0 shrink truncate text-sm leading-[normal] font-medium text-foreground">
              {selectedProviderLabel}
            </span>
            <ChevronDown size={14} />
          </button>''')
p.rep('''            desktopPreventInitialFlash
          />
        </View>
      ) : null}''', '''            desktopPreventInitialFlash
          />
        </div>
      ) : null}''')
p.rep('''      {showLoadMore ? (
        <View style={styles.footer}>''', '''      {showLoadMore ? (
        <div className="flex flex-col items-center pt-2">''')
p.rep('''            {t("importSession.actions.loadMore")}
          </Button>
        </View>
      ) : null}''', '''            {t("importSession.actions.loadMore")}
          </Button>
        </div>
      ) : null}''')
p.cut_from("const styles = StyleSheet.create")
p.s += '''
const STATUS_TEXT = "text-sm leading-[normal] text-muted-foreground";
'''
p.check()
p.write("importing a provider session started outside BySpace; DOM view.",
        "import-session-sheet.py")
