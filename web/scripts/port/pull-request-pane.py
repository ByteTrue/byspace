#!/usr/bin/env python3
"""Port packages/app's PR pane (git/pull-request-panel/pane.tsx) to web/src/overrides: the
PullRequestPane logic (refresh, check details, "Add to chat" for comments, reviews, threads and
check logs, activity collapse state, forge contributions) is the Expo file's; its view is DOM. The
activity cards below it are hand-written in web/src/pull-request/activity-cards.tsx."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "packages/app/src"
OVR = ROOT / "web/src/overrides"

state = {"s": (APP / "git/pull-request-panel/pane.tsx").read_text(encoding="utf-8")}


def rep(old, new, count=1):
    n = state["s"].count(old)
    if n != count:
        raise SystemExit(f"pr-pane: expected {count} of:\n{old[:300]}\n--- found {n}")
    state["s"] = state["s"].replace(old, new)


def replace_between(start_marker, end_marker, new, include_end=False):
    s = state["s"]
    if s.count(start_marker) != 1:
        raise SystemExit(f"pr-pane: start marker not unique: {start_marker[:80]}")
    start = s.index(start_marker)
    end = s.index(end_marker, start)
    if include_end:
        end += len(end_marker)
    state["s"] = s[:start] + new + s[end:]


# ---------------------------------------------------------------- imports
rep('import { Image, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";\n', "")
rep('import { StyleSheet, withUnistyles } from "react-native-unistyles";\n', "")
replace_between('import {\n  CircleCheck,', '} from "lucide-react-native";\n', '''import {
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  MessageSquarePlus,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
''', include_end=True)
rep('import type { PressableStateCallbackType } from "react-native";\n', "")
rep('import { StatusBadge } from "@/components/ui/status-badge";\n', "")
rep('''import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
''', "")
rep('''  PaneContentToolbar,
  paneContentToolbarIconSize,
  paneContentToolbarIconButtonStyle,
} from "@/components/ui/pane-content-toolbar";''', '''  PaneContentToolbar,
  paneContentToolbarIconSize,
  ToolbarButton,
} from "@/components/ui/pane-content-toolbar";''')
rep('import { ICON_SIZE, type Theme } from "@/styles/theme";\n', "")
rep('import { formatPullRequestThreadPath } from "./activity-location";\n', "")
rep('import { getActivityVerb, getStateLabel } from "./data";', 'import { getStateLabel } from "./data";')
rep('''import {
  buildPrTimeline,
  type PrReviewEntry,
  type PrThreadEntry,
  type PrTimelineEntry,
} from "./timeline";''', 'import { buildPrTimeline, type PrThreadEntry } from "./timeline";')
rep('''import {
  Section,
  SummaryPill,
  dangerColorMapping,
  foregroundMutedColorMapping,
  sectionKitStyles,
  successColorMapping,
} from "./section-kit";''', '''import { Section, SummaryPill, sectionKitClassNames } from "./section-kit";
import { TimelineEntryCard } from "~/pull-request/activity-cards";
import { cn } from "cn";''')
# Relative imports would bypass the web overrides (skeleton, checks, section kit); go through `@/`.
for module in ["activity-skeleton", "activity-state", "context-attachment", "checks-section", "data",
               "timeline", "section-kit"]:
    state["s"] = state["s"].replace(f'from "./{module}";', f'from "@/git/pull-request-panel/{module}";')
if 'from "./' in state["s"]:
    raise SystemExit("pr-pane: relative import left")

# ---------------------------------------------------------------- presentation constants
replace_between("const ThemedCircleCheck = withUnistyles(CircleCheck);", "const CLIENT_PANE_CONTRIBUTIONS", "")
replace_between("type IconColorMapping = typeof foregroundColorMapping;", "function addLoadingCheck(", '''const PR_STATE_PRESENTATION: Record<PrState, { Icon: LucideIcon; className: string }> = {
  open: { Icon: GitPullRequest, className: "text-status-success" },
  draft: { Icon: GitPullRequestDraft, className: "text-muted-foreground" },
  merged: { Icon: GitMerge, className: "text-status-merged" },
  closed: { Icon: GitPullRequestClosed, className: "text-status-danger" },
};

const SUMMARY_COMMENT_ICON = <MessageSquare size={11} className="text-muted-foreground" />;
const SUMMARY_APPROVAL_ICON = <CheckPresentationIcon presentation="success" size={12} />;
const SUMMARY_CHANGES_REQUESTED_ICON = <CheckPresentationIcon presentation="failure" size={12} />;

''')

# ---------------------------------------------------------------- PullRequestPane's view
rep('''  const toolbarRefreshButtonStyle = useCallback(
    (state: PressableStateCallbackType) => refreshButtonStyle(state, isCompact),
    [isCompact],
  );
''', "")
rep('''  const statePresentation = PR_STATE_PRESENTATION[data.state];''', '''  const statePresentation = PR_STATE_PRESENTATION[data.state];
  const activitySummary = (
    <>
      <SummaryPill count={approvals} icon={SUMMARY_APPROVAL_ICON} variant="success" />
      <SummaryPill
        count={changesRequested}
        icon={SUMMARY_CHANGES_REQUESTED_ICON}
        variant="danger"
      />
      <SummaryPill count={commentCount} icon={SUMMARY_COMMENT_ICON} variant="muted" />
    </>
  );''')
replace_between('  return (\n    <View style={styles.root} testID="pr-pane">', "function stateLabelStyle(state: PrState) {", '''  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar" data-testid="pr-pane">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PaneContentToolbar
          className="flex items-center justify-between px-3"
          testID="pr-pane-toolbar"
        >
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              leftIcon={ExternalLink}
              onPress={handleOpenPrUrl}
              className="h-6 min-h-6 gap-1 rounded-md px-1 py-0"
              testID="pr-pane-view-pr"
            >
              {t("workspace.git.pr.actions.viewPullRequest")}
            </Button>
          </div>
          {refreshSupported ? (
            <ToolbarButton
              label={
                isRefreshing
                  ? t("workspace.git.diff.refreshing")
                  : t("workspace.git.diff.refreshState", { brand: forgePresentation.brandLabel })
              }
              compact={isCompact}
              disabled={isRefreshing}
              testID="pr-pane-refresh"
              onPress={handleRefresh}
            >
              {isRefreshing ? (
                <LoadingSpinner
                  size={paneContentToolbarIconSize(isCompact)}
                  className="text-muted-foreground"
                />
              ) : (
                <RotateCw
                  size={paneContentToolbarIconSize(isCompact)}
                  className="text-muted-foreground"
                />
              )}
            </ToolbarButton>
          ) : null}
        </PaneContentToolbar>

        <button
          type="button"
          onClick={handleOpenPrUrl}
          className="group/pr-header flex w-full flex-col gap-2 p-4 text-left outline-none focus-visible:bg-sidebar-accent"
        >
          <span className="text-sm leading-[22px] text-foreground" data-testid="pr-pane-title">
            {data.title}
            <span className="text-muted-foreground">
              {" "}
              {forgePresentation.numberPrefix}
              {data.number}
            </span>
          </span>
          <span className="flex min-h-4 w-full items-center gap-1">
            <StateIcon size={14} className={cn("shrink-0", statePresentation.className)} />
            <span
              className={cn("text-xs", statePresentation.className)}
              data-testid="pr-pane-state"
            >
              {getStateLabel(data.state)}
            </span>
            {nativeHeaderMeta}
            {repoIdentity ? (
              <span className="ml-1 min-w-0 shrink truncate text-xs text-muted-foreground">
                {repoIdentity}
              </span>
            ) : null}
            <ExternalLink
              size={12}
              className="ml-1 shrink-0 text-muted-foreground opacity-0 group-hover/pr-header:opacity-100"
            />
          </span>
        </button>

        {nativeChecksSection ?? (
          <ChecksSection
            checks={data.checks}
            open={checksOpen}
            onToggle={handleToggleChecks}
            attachEnabled={attachEnabled}
            loadingCheckKeys={loadingCheckKeys}
            onAddLogsToChat={handleAddCheckLogsToChat}
          />
        )}

        <div className="h-px bg-border" />

        <Section
          title="Activity"
          open={activityOpen}
          onToggle={handleToggleActivity}
          summary={activitySummary}
        >
          {timelineEntries.length > 0 && attachEnabled && visibleEntries.length > 0 ? (
            <div className="flex min-h-7 items-center pr-3 pb-2">
              <Button
                variant="ghost"
                size="xs"
                leftIcon={MessageSquarePlus}
                onPress={handleAddAllToChat}
                disabled={activityLoading}
              >
                Add all to chat
              </Button>
            </div>
          ) : null}
          {activityLoading ? <PrActivitySkeleton /> : null}
          {!activityLoading && visibleEntries.length === 0 ? (
            <p className={sectionKitClassNames.emptyText}>No activity yet</p>
          ) : null}
          {!activityLoading
            ? visibleEntries.map(({ entry, collapsed }) => (
                <TimelineEntryCard
                  key={entry.id}
                  entry={entry}
                  collapsed={collapsed}
                  collapsedEntryIds={collapsedEntryIds}
                  attachEnabled={attachEnabled}
                  brandLabel={forgePresentation.brandLabel}
                  onAddToChat={handleAddActivityToChat}
                  onAddThreadToChat={handleAddThreadToChat}
                  onToggleCollapsed={handleToggleEntryCollapsed}
                />
              ))
            : null}
        </Section>
      </div>
    </div>
  );
}
''')
# Everything after PullRequestPane is view; it lives in web/src/pull-request/activity-cards.tsx.
state["s"] = state["s"][: state["s"].index("function stateLabelStyle(state: PrState) {")].rstrip() + "\n"

for needle in ["<View", "<Text", "<Pressable", "<ScrollView", "styles.", "StyleSheet", "withUnistyles",
               "Themed", "uniProps", "PressableStateCallbackType", "react-native\""]:
    if needle in state["s"]:
        i = state["s"].index(needle)
        raise SystemExit(f"pr-pane: leftover {needle}: {state['s'][i - 200:i + 200]}")

(OVR / "git/pull-request-panel/pane.tsx").write_text(
    "// Override of packages/app/src/git/pull-request-panel/pane.tsx. The pane's logic is the Expo\n"
    "// file's; the view is DOM, and the activity cards are web/src/pull-request/activity-cards.tsx.\n"
    "// Generated from the Expo file by web/scripts/port/pull-request-pane.py.\n"
    "// After changing either file, rerun it and then npm run format:files; do not edit by hand.\n"
    + state["s"], encoding="utf-8")
print("ok")
