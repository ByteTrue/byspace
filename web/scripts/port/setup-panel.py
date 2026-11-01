#!/usr/bin/env python3
"""Port packages/app's setup panel (panels/setup-panel.tsx) to web/src/overrides: the descriptor,
snapshot fetching, auto-expand rules and log processing are the Expo file's; the view is DOM."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src"
OVR = ROOT / "web/src/overrides"

state = {"s": (APP / "panels/setup-panel.tsx").read_text(encoding="utf-8")}


def rep(old, new, count=1):
    n = state["s"].count(old)
    if n != count:
        raise SystemExit(f"setup-panel: expected {count} of:\n{old[:300]}\n--- found {n}")
    state["s"] = state["s"].replace(old, new)


def replace_between(start_marker, end_marker, new):
    s = state["s"]
    if s.count(start_marker) != 1:
        raise SystemExit(f"setup-panel: start marker not unique: {start_marker[:80]}")
    start = s.index(start_marker)
    end = s.index(end_marker, start)
    state["s"] = s[:start] + new + s[end:]


LOG_BOX = "max-h-[400px] overflow-y-auto p-3"
LOG_TEXT = "font-mono text-[13px] leading-5 whitespace-pre-wrap break-words text-foreground select-text"
ERROR_CARD = "bg-red-100 p-3 text-sm leading-[18px] whitespace-pre-wrap text-red-800 select-text dark:bg-red-950 dark:text-red-200"

# ---------------------------------------------------------------- imports
rep('import { CheckCircle2, ChevronRight, CircleAlert, SquareTerminal } from "lucide-react-native";',
    'import { CheckCircle2, ChevronRight, CircleAlert, SquareTerminal } from "lucide-react";')
rep('import { Pressable, type PressableStateCallbackType, ScrollView, Text, View } from "react-native";\n', "")
rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n', "")
rep('import { CODE_SURFACE_DATASET } from "@/styles/code-surface";\n', "")
rep('import type { Theme } from "@/styles/theme";\n', 'import { cn } from "cn";\n')

# ---------------------------------------------------------------- view pieces
rep('''  if (status === "running") {
    return <ThemedLoadingSpinner size={14} uniProps={foregroundColorMapping} />;
  }
  if (status === "completed") {
    return <ThemedCheckCircle2 size={14} uniProps={greenColorMapping} />;
  }
  return <ThemedCircleAlert size={14} uniProps={redColorMapping} />;''', '''  if (status === "running") {
    return <LoadingSpinner size={14} className="text-foreground" />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={14} className="text-green-500" />;
  }
  return <CircleAlert size={14} className="text-red-500" />;''')

rep('''    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      testID="workspace-setup-panel"
    >
      {/* Hidden element for status — preserves testID for E2E */}
      <Text style={styles.hiddenStatus} testID="workspace-setup-status">
        {statusLabel}
      </Text>''', '''    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4"
      data-testid="workspace-setup-panel"
    >
      {/* Hidden element for status — preserves testID for E2E */}
      <span className="sr-only" data-testid="workspace-setup-status">
        {statusLabel}
      </span>''')
rep('''        onToggle={toggleExpanded}
      />
    </ScrollView>
  );''', '''        onToggle={toggleExpanded}
      />
    </div>
  );''')

rep('''    return (
      <View style={styles.waitingContainer}>
        <ThemedLoadingSpinner size="large" uniProps={foregroundMutedColorMapping} />
        <Text style={styles.waitingText}>{t("workspace.setup.waiting")}</Text>
      </View>
    );''', '''    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <LoadingSpinner size="large" className="text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("workspace.setup.waiting")}</span>
      </div>
    );''')
rep('''    return (
      <View style={styles.emptyContainer}>
        <Text
          style={styles.emptyText}
          accessible
          accessibilityLabel={t("workspace.setup.accessibility.noCommands")}
        >
          {t("workspace.setup.empty.noCommands")}
        </Text>
      </View>
    );''', '''    return (
      <div className="flex flex-1 items-center justify-center">
        <span
          className="text-sm text-muted-foreground"
          aria-label={t("workspace.setup.accessibility.noCommands")}
        >
          {t("workspace.setup.empty.noCommands")}
        </span>
      </div>
    );''')
rep('''    <View style={styles.commandList}>
      {commands.map((command) => {''', '''    <div className="flex flex-col gap-2">
      {commands.map((command) => {''')
rep('''      <TopLevelSetupError snapshotError={snapshot?.error ?? null} commands={commands} />
    </View>
  );''', '''      <TopLevelSetupError snapshotError={snapshot?.error ?? null} commands={commands} />
    </div>
  );''')

rep('''  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.commandRow,
      showDetail && styles.commandRowExpanded,
      pressed && styles.commandRowPressed,
    ],
    [showDetail],
  );

  const accessibilityState = useMemo(() => ({ expanded: showDetail }), [showDetail]);

''', "")
replace_between('''  return (
    <View style={styles.commandItem}>''', '''export const setupPanelRegistration = definePanel("setup", {''', f'''  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={{handlePress}}
        aria-expanded={{showDetail}}
        className={{cn(
          "flex w-full items-center gap-2 bg-card px-3 py-2 text-left active:opacity-80",
          showDetail && "border-b",
          !isExpandable && "cursor-default",
        )}}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">
          <CommandStatusIcon status={{command.status}} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm leading-[18px] text-foreground">
          {{command.command}}
        </span>
        {{command.durationMs != null ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {{formatDuration(command.durationMs)}}
          </span>
        ) : null}}
        <SetupCommandChevron showDetail={{showDetail}} />
      </button>
      {{showDetail ? (
        <div className="bg-background">
          {{hasLog ? (
            <div
              className="{LOG_BOX}"
              data-testid="workspace-setup-log"
              aria-label={{t("workspace.setup.accessibility.log")}}
            >
              <pre className="{LOG_TEXT}">{{processedLog}}</pre>
            </div>
          ) : (
            <div
              className="p-3"
              data-testid="workspace-setup-log"
              aria-label={{t("workspace.setup.accessibility.log")}}
            >
              <span className="text-sm text-muted-foreground italic">
                {{t("workspace.setup.log.noOutput")}}
              </span>
            </div>
          )}}
          {{hasError && errorMessage ? <div className="{ERROR_CARD}">{{errorMessage}}</div> : null}}
        </div>
      ) : null}}
    </div>
  );
}}

''')

replace_between('''function SetupCommandChevron({ showDetail }: { showDetail: boolean }) {''', '''const styles = StyleSheet.create((theme) => ({''', f'''function SetupCommandChevron({{ showDetail }}: {{ showDetail: boolean }}) {{
  return (
    <ChevronRight
      size={{14}}
      className={{cn("shrink-0 text-muted-foreground", showDetail && "rotate-90")}}
    />
  );
}}

function StandaloneLogView({{ commands, log }}: {{ commands: SetupCommand[]; log: string }}) {{
  const {{ t }} = useTranslation();
  if (commands.length !== 0 || log.trim().length === 0) return null;
  return (
    <div
      className="{LOG_BOX}"
      data-testid="workspace-setup-log"
      aria-label={{t("workspace.setup.accessibility.log")}}
    >
      <pre className="{LOG_TEXT}">{{log}}</pre>
    </div>
  );
}}

function TopLevelSetupError({{
  snapshotError,
  commands,
}}: {{
  snapshotError: string | null;
  commands: SetupCommand[];
}}) {{
  if (!snapshotError) return null;
  if (commands.some((c) => c.status === "failed")) return null;
  return <div className="{ERROR_CARD}">{{snapshotError}}</div>;
}}

''')
state["s"] = state["s"][: state["s"].index("const styles = StyleSheet.create((theme) => ({")].rstrip() + "\n"

for needle in ["<View", "<Text", "<Pressable", "<ScrollView", "styles.", "StyleSheet", "withUnistyles",
               "Themed", "uniProps", "PressableStateCallbackType", "react-native\"", "ColorMapping"]:
    if needle in state["s"]:
        i = state["s"].index(needle)
        raise SystemExit(f"setup-panel: leftover {needle}: {state['s'][i - 200:i + 200]}")

(OVR / "panels/setup-panel.tsx").write_text(
    "// Override of packages/app/src/panels/setup-panel.tsx: the worktree setup log — one collapsible\n"
    "// row per setup command, the running one open, its output below. Same logic; the view is DOM.\n"
    "// Generated from the Expo file by web/scripts/port/setup-panel.py.\n"
    "// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n"
    + state["s"], encoding="utf-8")
print("ok")
