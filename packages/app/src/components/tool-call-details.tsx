import React, { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  View,
  Text,
  ScrollView as RNScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";
import {
  buildBySpaceToolDetailSections,
  type BySpaceToolDetailSection,
} from "@bytetrue/protocol/byspace-tool-call-detail";
import { buildLineDiff, parseUnifiedDiff, type DiffLine } from "@/utils/tool-call-parsers";
import { highlightDiffLines } from "@/utils/diff-highlight";
import { hasMeaningfulToolCallDetail } from "@/utils/tool-call-detail-state";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { extensionFromPath, highlightToKeyedLines } from "@/utils/highlight-cache";
import { HighlightedLines } from "./highlighted-content";
import { DiffViewer } from "./diff-viewer";
import { getCodeInsets } from "./code-insets";
import { isWeb } from "@/constants/platform";

const ScrollView = isWeb ? RNScrollView : GHScrollView;

// ---- Content Component ----

interface ToolCallDetailsContentProps {
  toolName?: string;
  detail?: ToolCallDetail;
  errorText?: string;
  maxHeight?: number;
  fillAvailableHeight?: boolean;
  showLoadingSkeleton?: boolean;
  /** Streaming content (thinking) keeps the scroll pinned to its newest lines. */
  followTail?: boolean;
}

interface DetailStyles {
  sectionFillStyle: StyleProp<ViewStyle>;
  codeBlockFillStyle: StyleProp<ViewStyle>;
  codeVerticalScrollStyle: StyleProp<ViewStyle>;
  scrollAreaFillStyle: StyleProp<ViewStyle>;
  scrollAreaStyle: StyleProp<ViewStyle>;
  fullBleedContainerStyle: StyleProp<ViewStyle>;
  loadingContainerStyle: StyleProp<ViewStyle>;
  resolvedMaxHeight: number | undefined;
  shouldFill: boolean;
  isFullBleed: boolean;
}

function resolveIsFullBleed(detail: ToolCallDetail | undefined): boolean {
  return detail?.type === "edit" || detail?.type === "shell" || detail?.type === "write";
}

function resolveShouldFill(
  detail: ToolCallDetail | undefined,
  fillAvailableHeight: boolean,
): boolean {
  if (!fillAvailableHeight) return false;
  const t = detail?.type;
  return t === "shell" || t === "edit" || t === "write" || t === "read" || t === "sub_agent";
}

function useDetailStyles(
  detail: ToolCallDetail | undefined,
  resolvedMaxHeight: number | undefined,
  fillAvailableHeight: boolean,
): DetailStyles {
  const isFullBleed = resolveIsFullBleed(detail);
  const shouldFill = resolveShouldFill(detail, fillAvailableHeight);
  const sectionFillStyle = useMemo(
    () => [styles.section, shouldFill && styles.fillHeight],
    [shouldFill],
  );
  const codeBlockFillStyle = useMemo(
    () => [styles.diffContainer, shouldFill && styles.fillHeight],
    [shouldFill],
  );
  const codeVerticalScrollStyle = useMemo(
    () => [
      styles.codeVerticalScroll,
      resolvedMaxHeight !== undefined && inlineUnistylesStyle({ maxHeight: resolvedMaxHeight }),
      shouldFill && styles.fillHeight,
    ],
    [resolvedMaxHeight, shouldFill],
  );
  const scrollAreaFillStyle = useMemo(
    () => [
      resolvedMaxHeight !== undefined && inlineUnistylesStyle({ maxHeight: resolvedMaxHeight }),
      shouldFill && styles.fillHeight,
    ],
    [resolvedMaxHeight, shouldFill],
  );
  const scrollAreaStyle = useMemo(
    () => [
      resolvedMaxHeight !== undefined && inlineUnistylesStyle({ maxHeight: resolvedMaxHeight }),
    ],
    [resolvedMaxHeight],
  );
  const fullBleedContainerStyle = useMemo(
    () => [
      isFullBleed ? styles.fullBleedContainer : styles.paddedContainer,
      shouldFill && styles.fillHeight,
    ],
    [isFullBleed, shouldFill],
  );
  const loadingContainerStyle = useMemo(
    () => [styles.loadingContainer, fillAvailableHeight && styles.fillHeight],
    [fillAvailableHeight],
  );

  return {
    sectionFillStyle,
    codeBlockFillStyle,
    codeVerticalScrollStyle,
    scrollAreaFillStyle,
    scrollAreaStyle,
    fullBleedContainerStyle,
    loadingContainerStyle,
    resolvedMaxHeight,
    shouldFill,
    isFullBleed,
  };
}

function useDiffLines(detail: ToolCallDetail | undefined): DiffLine[] | undefined {
  return useMemo(() => {
    if (!detail || detail.type !== "edit") return undefined;
    const diffLines = detail.unifiedDiff
      ? parseUnifiedDiff(detail.unifiedDiff)
      : buildLineDiff(detail.oldString ?? "", detail.newString ?? "");
    return highlightDiffLines(diffLines, detail.filePath);
  }, [detail]);
}

interface ShellDetailProps {
  command: string;
  output: string | null | undefined;
  ds: DetailStyles;
}

function ShellDetailSection({ command, output, ds }: ShellDetailProps) {
  const normalizedCommand = command.replace(/\n+$/, "");
  const commandOutput = (output ?? "").replace(/^\n+/, "");
  const hasOutput = commandOutput.length > 0;
  return (
    <View style={ds.sectionFillStyle}>
      <View style={ds.codeBlockFillStyle}>
        <ScrollView
          style={ds.codeVerticalScrollStyle}
          contentContainerStyle={styles.codeVerticalContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.codeHorizontalContent}
          >
            <View style={styles.codeLine} dataSet={CODE_SURFACE_DATASET}>
              <Text selectable style={styles.scrollText}>
                <Text style={styles.shellPrompt}>$ </Text>
                {normalizedCommand}
                {hasOutput ? `\n\n${commandOutput}` : ""}
              </Text>
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  );
}

interface WorktreeSetupDetailProps {
  log: string;
  branchName: string;
  worktreePath: string;
  ds: DetailStyles;
}

function WorktreeSetupDetailSection({
  log,
  branchName,
  worktreePath,
  ds,
}: WorktreeSetupDetailProps) {
  const setupLog = log.replace(/^\n+/, "");
  const hasLog = setupLog.length > 0;
  return (
    <View style={ds.sectionFillStyle}>
      <View style={ds.codeBlockFillStyle}>
        <ScrollView
          style={ds.codeVerticalScrollStyle}
          contentContainerStyle={styles.codeVerticalContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.codeHorizontalContent}
          >
            <View style={styles.codeLine} dataSet={CODE_SURFACE_DATASET}>
              <Text selectable style={styles.scrollText}>
                {hasLog ? setupLog : `Preparing worktree ${branchName} at ${worktreePath}`}
              </Text>
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  );
}

function resolveSubAgentFallbackHeader(
  subAgentType: string | null | undefined,
  description: string | null | undefined,
  fallbackText: string,
): string {
  if (subAgentType && description) {
    return `${subAgentType}: ${description}`;
  }
  return subAgentType ?? description ?? fallbackText;
}

interface SubAgentDetailProps {
  log: string;
  childSessionId: string | null | undefined;
  subAgentType: string | null | undefined;
  description: string | null | undefined;
  ds: DetailStyles;
}

interface SubAgentActivityRow {
  index: number;
  toolName: string;
  summary?: string;
}

interface ParsedSubAgentLog {
  actions: SubAgentActivityRow[];
  remainingLog: string;
}

function parseBracketedSubAgentLine(line: string, index: number): SubAgentActivityRow | null {
  const match = line.match(/^\[([^\]]+)\](?:\s+(.*))?$/);
  if (!match) {
    return null;
  }
  const toolName = match[1]?.trim();
  if (!toolName) {
    return null;
  }
  const summary = match[2]?.trim();
  return {
    index,
    toolName,
    ...(summary ? { summary } : {}),
  };
}

function parseSubAgentLog(log: string): ParsedSubAgentLog {
  const actions: SubAgentActivityRow[] = [];
  const remainingLines: string[] = [];
  for (const line of log.replace(/^\n+/, "").split("\n")) {
    const normalizedLine = line.trim();
    if (!normalizedLine) {
      continue;
    }
    const parsedAction = parseBracketedSubAgentLine(normalizedLine, actions.length + 1);
    if (parsedAction) {
      actions.push(parsedAction);
    } else {
      remainingLines.push(line);
    }
  }
  return {
    actions,
    remainingLog: remainingLines.join("\n").replace(/^\n+/, ""),
  };
}

function SubAgentActionRow({ action }: { action: SubAgentActivityRow }) {
  return (
    <View style={styles.subAgentActionRow}>
      <Text selectable style={styles.subAgentActionTool}>
        {formatSubAgentToolName(action.toolName)}
      </Text>
      {action.summary ? (
        <Text selectable style={styles.subAgentActionSummary}>
          {action.summary}
        </Text>
      ) : null}
    </View>
  );
}

function formatSubAgentToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return toolName;
  }
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function SubAgentLogText({
  activityLog,
  fallbackHeader,
  hasActions,
}: {
  activityLog: string;
  fallbackHeader: string;
  hasActions: boolean;
}) {
  if (activityLog.length > 0) {
    return (
      <Text selectable style={styles.scrollText}>
        {activityLog}
      </Text>
    );
  }
  if (!hasActions) {
    return (
      <Text selectable style={styles.scrollText}>
        {fallbackHeader}
      </Text>
    );
  }
  return null;
}

function SubAgentDetailSection({
  log,
  childSessionId,
  subAgentType,
  description,
  ds,
}: SubAgentDetailProps) {
  const { t } = useTranslation();
  const { actions, remainingLog } = useMemo(() => parseSubAgentLog(log), [log]);
  const fallbackHeader = resolveSubAgentFallbackHeader(
    subAgentType,
    description,
    t("toolCallDetails.subAgentActivity"),
  );
  const hasActions = actions.length > 0;
  return (
    <View style={ds.sectionFillStyle}>
      <View style={ds.codeBlockFillStyle}>
        <ScrollView
          style={ds.codeVerticalScrollStyle}
          contentContainerStyle={styles.codeVerticalContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.codeHorizontalContent}
          >
            <View style={styles.codeLine} dataSet={CODE_SURFACE_DATASET}>
              {childSessionId ? (
                <Text selectable style={styles.subAgentSessionText}>
                  session {childSessionId}
                </Text>
              ) : null}
              {hasActions ? (
                <View style={styles.subAgentActions}>
                  {actions.map((action) => (
                    <SubAgentActionRow key={action.index} action={action} />
                  ))}
                </View>
              ) : null}
              <SubAgentLogText
                activityLog={remainingLog}
                fallbackHeader={fallbackHeader}
                hasActions={hasActions}
              />
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  );
}

interface EditDetailProps {
  diffLines: DiffLine[] | undefined;
  ds: DetailStyles;
}

function EditDetailSection({ diffLines, ds }: EditDetailProps) {
  return (
    <View style={ds.sectionFillStyle}>
      {diffLines ? (
        <View style={ds.codeBlockFillStyle}>
          <DiffViewer
            diffLines={diffLines}
            maxHeight={ds.resolvedMaxHeight}
            fillAvailableHeight={ds.shouldFill}
          />
        </View>
      ) : null}
    </View>
  );
}

interface ScrollableContentProps {
  content: string;
  ds: DetailStyles;
  wrapInSectionFill?: boolean;
  // Drives syntax highlighting (extension only) and, with startLine, a gutter.
  filePath?: string | null;
  startLine?: number;
}

function ScrollableTextSection({
  content,
  ds,
  wrapInSectionFill = true,
  filePath,
  startLine,
}: ScrollableContentProps) {
  const keyedLines = useMemo(
    () => (filePath ? highlightToKeyedLines(content, extensionFromPath(filePath)) : null),
    [content, filePath],
  );
  const body = (
    <ScrollView
      style={ds.scrollAreaFillStyle}
      contentContainerStyle={styles.scrollContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator={true}
    >
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={true}>
        {keyedLines ? (
          <HighlightedLines lines={keyedLines} startLine={startLine} />
        ) : (
          <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
            {content}
          </Text>
        )}
      </ScrollView>
    </ScrollView>
  );
  if (!wrapInSectionFill) return body;
  return <View style={ds.sectionFillStyle}>{body}</View>;
}

interface FetchDetailProps {
  url: string;
  result: string | null | undefined;
  ds: DetailStyles;
}

function FetchDetailSection({ url, result, ds }: FetchDetailProps) {
  return (
    <View style={ds.sectionFillStyle}>
      <ScrollView
        style={ds.scrollAreaFillStyle}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
          <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
            {result ? `${url}\n\n${result}` : url}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function ScrollablePlainTextSection({ text, ds }: { text: string; ds: DetailStyles }) {
  return (
    <View style={styles.section}>
      <ScrollView
        style={ds.scrollAreaStyle}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <Text selectable style={styles.plainText}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * Structural view of the platform ScrollView instance; both the react-native-web and
 * gesture-handler ScrollViews expose scrollToEnd at runtime.
 */
interface FollowableScrollViewRef {
  scrollToEnd: (options?: { animated?: boolean }) => void;
}

/** Within this distance of the tail a scroll counts as "at the bottom". */
const TAIL_FOLLOW_THRESHOLD_PX = 32;

/**
 * Thinking text while the model streams it. Without the pin, the capped-height scroll area
 * stays at the top while the newest reasoning pours in below the fold; the pin keeps the tail
 * visible until the user scrolls up, and resumes when they return to the bottom.
 */
function ThinkingDetailSection({
  text,
  ds,
  followTail = false,
}: {
  text: string;
  ds: DetailStyles;
  followTail?: boolean;
}) {
  const scrollRef = useRef<FollowableScrollViewRef | null>(null);
  const followTailRef = useRef(followTail);
  followTailRef.current = followTail;
  const stickToBottomRef = useRef(true);

  const attachScrollView = useCallback((instance: FollowableScrollViewRef | null) => {
    scrollRef.current = instance;
  }, []);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    stickToBottomRef.current = distanceFromBottom < TAIL_FOLLOW_THRESHOLD_PX;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (!followTailRef.current || !stickToBottomRef.current) {
      return;
    }
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);

  // First paint of a streaming block can already be taller than the cap; later growth is
  // followed by onContentSizeChange. Toggling followTail (a folded-then-reopened block)
  // restarts pinned instead of inheriting a stale release.
  useEffect(() => {
    if (!followTail) {
      stickToBottomRef.current = true;
      return;
    }
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [followTail]);

  return (
    <View style={styles.section}>
      <ScrollView
        ref={attachScrollView}
        testID="thinking-detail-scroll"
        style={ds.scrollAreaStyle}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={16}
      >
        <Text selectable style={styles.plainText}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

interface SearchDetail {
  query?: string;
  content?: string;
  filePaths?: string[];
  webResults?: { title: string; url: string }[];
  annotations?: string[];
}

function buildSearchSections(detail: SearchDetail, ds: DetailStyles): ReactNode[] {
  const out: ReactNode[] = [];
  if (detail.content) {
    out.push(
      <View key="search-content" style={styles.section}>
        <ScrollView
          style={ds.scrollAreaStyle}
          contentContainerStyle={styles.scrollContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
            <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
              {detail.content}
            </Text>
          </ScrollView>
        </ScrollView>
      </View>,
    );
  }
  if (detail.filePaths && detail.filePaths.length > 0) {
    out.push(
      <View key="search-files" style={styles.section}>
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {detail.filePaths.join("\n")}
        </Text>
      </View>,
    );
  }
  if (detail.webResults && detail.webResults.length > 0) {
    out.push(
      <View key="search-web-results" style={styles.section}>
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {detail.webResults.map((entry) => `${entry.title}\n${entry.url}`).join("\n\n")}
        </Text>
      </View>,
    );
  }
  if (detail.annotations && detail.annotations.length > 0) {
    out.push(
      <View key="search-annotations" style={styles.section}>
        <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
          {detail.annotations.join("\n\n")}
        </Text>
      </View>,
    );
  }
  return out;
}

function serializeUnknownValue(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface UnknownDetail {
  input: unknown;
  output: unknown;
}

function buildUnknownSections(detail: UnknownDetail, ds: DetailStyles, t: TFunction): ReactNode[] {
  const plainInputText =
    typeof detail.input === "string" && detail.output === null ? detail.input : null;

  if (plainInputText !== null) {
    return [<ScrollablePlainTextSection key="unknown-plain-text" text={plainInputText} ds={ds} />];
  }

  const sectionsFromTopLevel = [
    { title: t("toolCallDetails.input"), value: detail.input },
    { title: t("toolCallDetails.output"), value: detail.output },
  ].filter((entry) =>
    hasMeaningfulToolCallDetail({
      type: "unknown",
      input: entry.value ?? null,
      output: null,
    }),
  );

  const out: ReactNode[] = [];
  for (const section of sectionsFromTopLevel) {
    const value = serializeUnknownValue(section.value);
    if (!value.length) {
      continue;
    }
    out.push(
      <View key={`${section.title}-header`} style={styles.groupHeader}>
        <Text style={styles.groupHeaderText}>{section.title}</Text>
      </View>,
    );
    out.push(
      <View key={`${section.title}-value`} style={styles.section}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          contentContainerStyle={styles.jsonContent}
          showsHorizontalScrollIndicator={true}
        >
          <Text selectable style={styles.scrollText} dataSet={CODE_SURFACE_DATASET}>
            {value}
          </Text>
        </ScrollView>
      </View>,
    );
  }
  return out;
}

function BySpaceDetailSection({ section }: { section: BySpaceToolDetailSection }) {
  return (
    <View style={styles.byspaceSection}>
      <Text style={styles.byspaceSectionTitle}>{section.title}</Text>
      {section.kind === "prose" ? (
        <Text selectable style={styles.byspaceProse}>
          {section.text}
        </Text>
      ) : (
        <View style={styles.byspaceFields}>
          {section.fields.map((field) => (
            <View key={field.label} style={styles.byspaceFieldRow}>
              <Text style={styles.byspaceFieldLabel}>{field.label}</Text>
              <Text selectable style={styles.byspaceFieldValue}>
                {field.value}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function buildBySpaceUnknownSections(
  toolName: string | undefined,
  detail: UnknownDetail,
): ReactNode[] | null {
  if (!toolName) return null;
  const sections = buildBySpaceToolDetailSections(toolName, detail.input, detail.output);
  if (!sections) return null;
  return sections.map((section) => <BySpaceDetailSection key={section.title} section={section} />);
}

function buildDetailSections(
  toolName: string | undefined,
  detail: ToolCallDetail | undefined,
  diffLines: DiffLine[] | undefined,
  ds: DetailStyles,
  t: TFunction,
): ReactNode[] {
  if (!detail) return [];
  if (detail.type === "shell") {
    return [
      <ShellDetailSection key="shell" command={detail.command} output={detail.output} ds={ds} />,
    ];
  }
  if (detail.type === "worktree_setup") {
    return [
      <WorktreeSetupDetailSection
        key="worktree-setup"
        log={detail.log}
        branchName={detail.branchName}
        worktreePath={detail.worktreePath}
        ds={ds}
      />,
    ];
  }
  if (detail.type === "sub_agent") {
    return [
      <SubAgentDetailSection
        key="sub-agent"
        log={detail.log}
        childSessionId={detail.childSessionId}
        subAgentType={detail.subAgentType}
        description={detail.description}
        ds={ds}
      />,
    ];
  }
  if (detail.type === "edit") {
    return [<EditDetailSection key="edit" diffLines={diffLines} ds={ds} />];
  }
  if (detail.type === "write") {
    return [
      <View key="write" style={ds.sectionFillStyle}>
        {detail.content ? (
          <ScrollableTextSection
            content={detail.content}
            ds={ds}
            wrapInSectionFill={false}
            filePath={detail.filePath}
          />
        ) : null}
      </View>,
    ];
  }
  if (detail.type === "read") {
    if (!detail.content) return [];
    return [
      <ScrollableTextSection
        key="read"
        content={detail.content}
        ds={ds}
        filePath={detail.filePath}
        startLine={detail.offset ?? 1}
      />,
    ];
  }
  if (detail.type === "search") {
    return buildSearchSections(detail, ds);
  }
  if (detail.type === "fetch") {
    return [<FetchDetailSection key="fetch" url={detail.url} result={detail.result} ds={ds} />];
  }
  if (detail.type === "plain_text") {
    if (!detail.text) return [];
    return [<ScrollablePlainTextSection key="plain-text" text={detail.text} ds={ds} />];
  }
  if (detail.type === "unknown") {
    return buildBySpaceUnknownSections(toolName, detail) ?? buildUnknownSections(detail, ds, t);
  }
  return [];
}

function ErrorSection({ errorText }: { errorText: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, styles.errorText]}>{t("toolCallDetails.error")}</Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        contentContainerStyle={styles.jsonContent}
        showsHorizontalScrollIndicator={true}
      >
        <Text
          selectable
          style={[styles.scrollText, styles.errorText]}
          dataSet={CODE_SURFACE_DATASET}
        >
          {errorText}
        </Text>
      </ScrollView>
    </View>
  );
}

function LoadingSkeleton({ containerStyle }: { containerStyle: StyleProp<ViewStyle> }) {
  return (
    <View style={containerStyle}>
      <View style={styles.loadingLineWide} />
      <View style={styles.loadingLineMedium} />
      <View style={styles.loadingLineShort} />
    </View>
  );
}

export function ToolCallDetailsContent({
  toolName,
  detail,
  errorText,
  maxHeight,
  fillAvailableHeight = false,
  showLoadingSkeleton = false,
  followTail = false,
}: ToolCallDetailsContentProps) {
  const { t } = useTranslation();
  const resolvedMaxHeight = fillAvailableHeight ? undefined : (maxHeight ?? 300);
  const ds = useDetailStyles(detail, resolvedMaxHeight, fillAvailableHeight);
  const diffLines = useDiffLines(detail);

  // Thinking renders its own section: while the block streams, its scroll area pins to the
  // newest lines instead of sitting at the top.
  const sections: ReactNode[] =
    toolName === "thinking" && detail?.type === "unknown" && typeof detail.input === "string"
      ? [
          <ThinkingDetailSection
            key="thinking"
            text={detail.input}
            ds={ds}
            followTail={followTail}
          />,
        ]
      : buildDetailSections(toolName, detail, diffLines, ds, t);

  if (errorText) {
    sections.push(<ErrorSection key="error" errorText={errorText} />);
  }

  if (sections.length === 0) {
    if (showLoadingSkeleton) {
      return <LoadingSkeleton containerStyle={ds.loadingContainerStyle} />;
    }
    return <Text style={styles.emptyStateText}>{t("toolCallDetails.empty")}</Text>;
  }

  return <View style={ds.fullBleedContainerStyle}>{sections}</View>;
}

// ---- Styles ----

const styles = StyleSheet.create((theme) => {
  const insets = getCodeInsets(theme);

  return {
    paddedContainer: {
      gap: theme.spacing[4],
      padding: 0,
    },
    fullBleedContainer: {
      gap: theme.spacing[2],
      padding: 0,
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      borderBottomWidth: theme.borderWidth[1],
      borderBottomColor: theme.colors.border,
    },
    groupHeaderText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.normal,
    },
    byspaceSection: {
      gap: theme.spacing[3],
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[4],
      borderBottomWidth: theme.borderWidth[1],
      borderBottomColor: theme.colors.border,
    },
    byspaceSectionTitle: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.base,
      fontWeight: theme.fontWeight.medium,
    },
    byspaceProse: {
      color: theme.colors.foreground,
      fontSize: theme.fontSize.content,
      lineHeight: Math.round(theme.fontSize.content * 1.5),
      overflowWrap: "anywhere",
    },
    byspaceFields: {
      gap: theme.spacing[3],
    },
    byspaceFieldRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[4],
    },
    byspaceFieldLabel: {
      width: 120,
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      lineHeight: Math.round(theme.fontSize.base * 1.5),
    },
    byspaceFieldValue: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.foreground,
      fontSize: theme.fontSize.base,
      lineHeight: Math.round(theme.fontSize.base * 1.5),
      overflowWrap: "anywhere",
    },
    section: {
      gap: theme.spacing[2],
    },
    fillHeight: {
      flex: 1,
      minHeight: 0,
    },
    plainText: {
      fontFamily: theme.fontFamily.ui,
      fontSize: theme.fontSize.base,
      color: theme.colors.foreground,
      lineHeight: 22,
      overflowWrap: "anywhere",
    },
    sectionTitle: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    rangeText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    diffContainer: {
      overflow: "hidden",
    },
    codeVerticalScroll: {},
    codeVerticalContent: {
      flexGrow: 1,
      paddingBottom: insets.extraBottom,
    },
    codeHorizontalContent: {
      paddingRight: insets.extraRight,
    },
    codeLine: {
      minWidth: "100%",
      paddingHorizontal: insets.padding,
      paddingVertical: insets.padding,
    },
    scrollContent: {
      padding: insets.padding,
    },
    scrollText: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
      lineHeight: 18,
      ...(isWeb
        ? {
            whiteSpace: "pre",
            overflowWrap: "normal",
          }
        : null),
    },
    shellPrompt: {
      color: theme.colors.foregroundMuted,
    },
    subAgentSessionText: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
      lineHeight: 18,
      marginBottom: theme.spacing[2],
    },
    subAgentActions: {
      gap: theme.spacing[1],
      marginBottom: theme.spacing[2],
    },
    subAgentActionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    subAgentActionTool: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foregroundMuted,
      lineHeight: 18,
    },
    subAgentActionSummary: {
      fontFamily: theme.fontFamily.mono,
      fontSize: theme.fontSize.code,
      color: theme.colors.foreground,
      lineHeight: 18,
    },
    jsonContent: {
      padding: insets.padding,
    },
    errorText: {
      color: theme.colors.destructive,
    },
    emptyStateText: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.base,
      fontStyle: "italic",
    },
    loadingContainer: {
      gap: theme.spacing[2],
      padding: theme.spacing[3],
    },
    loadingLineWide: {
      height: 12,
      width: "100%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface3,
    },
    loadingLineMedium: {
      height: 12,
      width: "72%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface3,
    },
    loadingLineShort: {
      height: 12,
      width: "48%",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface3,
    },
  };
});
