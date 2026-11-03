// Port of packages/app/src/components/tool-call-details.tsx: what a tool call shows when
// opened — the command and its output, the edit's diff, the file read or written, search hits,
// fetched pages, sub-agent activity, BySpace tool fields, or the raw input and output. Same
// sections and rules as the Expo file; the view is DOM.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";
import {
  buildBySpaceToolDetailSections,
  type BySpaceToolDetailSection,
} from "@bytetrue/protocol/byspace-tool-call-detail";
import { DiffViewer } from "@/components/diff-viewer";
import { HighlightedLines } from "@/components/highlighted-content";
import { highlightDiffLines } from "@/utils/diff-highlight";
import { extensionFromPath, highlightToKeyedLines } from "@/utils/highlight-cache";
import { hasMeaningfulToolCallDetail } from "@/utils/tool-call-detail-state";
import { buildLineDiff, parseUnifiedDiff, type DiffLine } from "@/utils/tool-call-parsers";
import { cn } from "cn";

interface DetailLayout {
  /** Fills the sheet on a phone instead of capping its height. */
  shouldFill: boolean;
  maxHeightStyle: CSSProperties | undefined;
}

function resolveShouldFill(
  detail: ToolCallDetail | undefined,
  fillAvailableHeight: boolean,
): boolean {
  if (!fillAvailableHeight) return false;
  const type = detail?.type;
  return (
    type === "shell" ||
    type === "edit" ||
    type === "write" ||
    type === "read" ||
    type === "sub_agent"
  );
}

const FILL = "min-h-0 flex-1";

function useDiffLines(detail: ToolCallDetail | undefined): DiffLine[] | undefined {
  return useMemo(() => {
    if (!detail || detail.type !== "edit") return undefined;
    const diffLines = detail.unifiedDiff
      ? parseUnifiedDiff(detail.unifiedDiff)
      : buildLineDiff(detail.oldString ?? "", detail.newString ?? "");
    return highlightDiffLines(diffLines, detail.filePath);
  }, [detail]);
}

/** A code box scrolling both ways: 12px padding, a little more past the end of each axis. */
function CodeScroll({ layout, children }: { layout: DetailLayout; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2", layout.shouldFill && FILL)}>
      <div className={cn("overflow-hidden", layout.shouldFill && FILL)}>
        <div
          className={cn("overflow-auto", layout.shouldFill && FILL)}
          style={layout.maxHeightStyle}
        >
          <div className="w-max min-w-full p-3 pr-7 pb-6" data-pmono="">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShellDetailSection({
  command,
  output,
  layout,
}: {
  command: string;
  output: string | null | undefined;
  layout: DetailLayout;
}) {
  const normalizedCommand = command.replace(/\n+$/, "");
  const commandOutput = (output ?? "").replace(/^\n+/, "");
  return (
    <CodeScroll layout={layout}>
      <pre className="tool-code select-text">
        <span className="text-muted-foreground">$ </span>
        {normalizedCommand}
        {commandOutput.length > 0 ? `\n\n${commandOutput}` : ""}
      </pre>
    </CodeScroll>
  );
}

function WorktreeSetupDetailSection({
  log,
  branchName,
  worktreePath,
  layout,
}: {
  log: string;
  branchName: string;
  worktreePath: string;
  layout: DetailLayout;
}) {
  const setupLog = log.replace(/^\n+/, "");
  return (
    <CodeScroll layout={layout}>
      <pre className="tool-code select-text">
        {setupLog.length > 0 ? setupLog : `Preparing worktree ${branchName} at ${worktreePath}`}
      </pre>
    </CodeScroll>
  );
}

interface SubAgentActivityRow {
  index: number;
  toolName: string;
  summary?: string;
}

function parseBracketedSubAgentLine(line: string, index: number): SubAgentActivityRow | null {
  const match = line.match(/^\[([^\]]+)\](?:\s+(.*))?$/);
  if (!match) return null;
  const toolName = match[1]?.trim();
  if (!toolName) return null;
  const summary = match[2]?.trim();
  return { index, toolName, ...(summary ? { summary } : {}) };
}

function parseSubAgentLog(log: string): { actions: SubAgentActivityRow[]; remainingLog: string } {
  const actions: SubAgentActivityRow[] = [];
  const remainingLines: string[] = [];
  for (const line of log.replace(/^\n+/, "").split("\n")) {
    const normalizedLine = line.trim();
    if (!normalizedLine) continue;
    const parsedAction = parseBracketedSubAgentLine(normalizedLine, actions.length + 1);
    if (parsedAction) actions.push(parsedAction);
    else remainingLines.push(line);
  }
  return { actions, remainingLog: remainingLines.join("\n").replace(/^\n+/, "") };
}

function formatSubAgentToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) return toolName;
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function SubAgentDetailSection({
  log,
  childSessionId,
  subAgentType,
  description,
  layout,
}: {
  log: string;
  childSessionId: string | null | undefined;
  subAgentType: string | null | undefined;
  description: string | null | undefined;
  layout: DetailLayout;
}) {
  const { t } = useTranslation();
  const { actions, remainingLog } = useMemo(() => parseSubAgentLog(log), [log]);
  let fallbackHeader = subAgentType ?? description ?? t("toolCallDetails.subAgentActivity");
  if (subAgentType && description) fallbackHeader = `${subAgentType}: ${description}`;
  const hasActions = actions.length > 0;
  let logText: string | null = null;
  if (remainingLog.length > 0) logText = remainingLog;
  else if (!hasActions) logText = fallbackHeader;
  return (
    <CodeScroll layout={layout}>
      {childSessionId ? (
        <pre className="tool-code mb-2 select-text">session {childSessionId}</pre>
      ) : null}
      {hasActions ? (
        <div className="mb-2 flex flex-col gap-1">
          {actions.map((action) => (
            <div key={action.index} className="flex items-center gap-2">
              <span className="tool-code select-text">
                {formatSubAgentToolName(action.toolName)}
              </span>
              {action.summary ? (
                <span className="tool-code text-foreground! select-text">{action.summary}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {logText !== null ? <pre className="tool-code select-text">{logText}</pre> : null}
    </CodeScroll>
  );
}

function ScrollableTextSection({
  content,
  layout,
  filePath,
  startLine,
}: {
  content: string;
  layout: DetailLayout;
  // Drives syntax highlighting (extension only) and, with startLine, a gutter.
  filePath?: string | null;
  startLine?: number;
}) {
  const keyedLines = useMemo(
    () => (filePath ? highlightToKeyedLines(content, extensionFromPath(filePath)) : null),
    [content, filePath],
  );
  return (
    <div className={cn("flex flex-col gap-2", layout.shouldFill && FILL)}>
      <div className={cn("overflow-auto", layout.shouldFill && FILL)} style={layout.maxHeightStyle}>
        <div className="w-max min-w-full p-3 select-text">
          {keyedLines ? (
            <HighlightedLines lines={keyedLines} startLine={startLine} />
          ) : (
            <pre className="tool-code" data-pmono="">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function MonoBlock({ text, layout }: { text: string; layout: DetailLayout }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-auto" style={layout.maxHeightStyle}>
        <div className="w-max min-w-full p-3">
          <pre className="tool-code select-text" data-pmono="">
            {text}
          </pre>
        </div>
      </div>
    </div>
  );
}

function PlainTextSection({ text, layout }: { text: string; layout: DetailLayout }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-y-auto" style={layout.maxHeightStyle}>
        <p className="p-3 text-sm leading-[22px] wrap-anywhere whitespace-pre-wrap text-foreground select-text">
          {text}
        </p>
      </div>
    </div>
  );
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
  layout,
  followTail = false,
}: {
  text: string;
  layout: DetailLayout;
  followTail?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(followTail);
  followTailRef.current = followTail;
  const stickToBottomRef = useRef(true);
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    stickToBottomRef.current =
      node.scrollHeight - (node.scrollTop + node.clientHeight) < TAIL_FOLLOW_THRESHOLD_PX;
  }, []);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !followTailRef.current || !stickToBottomRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [text]);
  // A folded-then-reopened block restarts pinned instead of inheriting a stale release.
  useEffect(() => {
    if (!followTail) {
      stickToBottomRef.current = true;
      return;
    }
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [followTail]);
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={scrollRef}
        data-testid="thinking-detail-scroll"
        className="overflow-y-auto"
        style={layout.maxHeightStyle}
        onScroll={handleScroll}
      >
        <p className="p-3 text-sm leading-[22px] wrap-anywhere whitespace-pre-wrap text-foreground select-text">
          {text}
        </p>
      </div>
    </div>
  );
}

interface SearchDetail {
  query?: string;
  content?: string;
  filePaths?: string[];
  webResults?: { title: string; url: string }[];
  annotations?: string[];
}

function buildSearchSections(detail: SearchDetail, layout: DetailLayout): ReactNode[] {
  const out: ReactNode[] = [];
  const flat = (key: string, text: string) => (
    <div key={key} className="flex flex-col gap-2">
      <pre className="tool-code select-text" data-pmono="">
        {text}
      </pre>
    </div>
  );
  if (detail.content)
    out.push(<MonoBlock key="search-content" text={detail.content} layout={layout} />);
  if (detail.filePaths && detail.filePaths.length > 0)
    out.push(flat("search-files", detail.filePaths.join("\n")));
  if (detail.webResults && detail.webResults.length > 0) {
    out.push(
      flat(
        "search-web-results",
        detail.webResults.map((entry) => `${entry.title}\n${entry.url}`).join("\n\n"),
      ),
    );
  }
  if (detail.annotations && detail.annotations.length > 0) {
    out.push(flat("search-annotations", detail.annotations.join("\n\n")));
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

function buildUnknownSections(
  detail: UnknownDetail,
  layout: DetailLayout,
  t: TFunction,
): ReactNode[] {
  if (typeof detail.input === "string" && detail.output === null) {
    return [<PlainTextSection key="unknown-plain-text" text={detail.input} layout={layout} />];
  }
  const sectionsFromTopLevel = [
    { title: t("toolCallDetails.input"), value: detail.input },
    { title: t("toolCallDetails.output"), value: detail.output },
  ].filter((entry) =>
    hasMeaningfulToolCallDetail({ type: "unknown", input: entry.value ?? null, output: null }),
  );
  const out: ReactNode[] = [];
  for (const section of sectionsFromTopLevel) {
    const value = serializeUnknownValue(section.value);
    if (!value.length) continue;
    out.push(
      <div key={`${section.title}-header`} className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-sm text-muted-foreground">{section.title}</span>
      </div>,
    );
    out.push(
      <div key={`${section.title}-value`} className="flex flex-col gap-2">
        <div className="overflow-x-auto">
          <pre className="tool-code w-max p-3 select-text" data-pmono="">
            {value}
          </pre>
        </div>
      </div>,
    );
  }
  return out;
}

function BySpaceDetailSection({ section }: { section: BySpaceToolDetailSection }) {
  return (
    <div className="flex flex-col gap-3 border-b p-4">
      <span className="text-sm font-medium text-foreground">{section.title}</span>
      {section.kind === "prose" ? (
        <p className="text-(length:--content-font-size) leading-[1.5] wrap-anywhere whitespace-pre-wrap text-foreground select-text">
          {section.text}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {section.fields.map((field) => (
            <div key={field.label} className="flex items-start gap-4">
              <span className="w-[120px] shrink-0 text-xs leading-[21px] text-muted-foreground">
                {field.label}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-[21px] wrap-anywhere text-foreground select-text">
                {field.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildDetailSections(
  toolName: string | undefined,
  detail: ToolCallDetail | undefined,
  diffLines: DiffLine[] | undefined,
  layout: DetailLayout,
  t: TFunction,
): ReactNode[] {
  if (!detail) return [];
  switch (detail.type) {
    case "shell":
      return [
        <ShellDetailSection
          key="shell"
          command={detail.command}
          output={detail.output}
          layout={layout}
        />,
      ];
    case "worktree_setup":
      return [
        <WorktreeSetupDetailSection
          key="worktree-setup"
          log={detail.log}
          branchName={detail.branchName}
          worktreePath={detail.worktreePath}
          layout={layout}
        />,
      ];
    case "sub_agent":
      return [
        <SubAgentDetailSection
          key="sub-agent"
          log={detail.log}
          childSessionId={detail.childSessionId}
          subAgentType={detail.subAgentType}
          description={detail.description}
          layout={layout}
        />,
      ];
    case "edit":
      return [<EditDetailSection key="edit" diffLines={diffLines} layout={layout} />];
    case "write":
      return [
        <WriteDetailSection
          key="write"
          content={detail.content}
          filePath={detail.filePath}
          layout={layout}
        />,
      ];
    default:
      return buildContentDetailSections(toolName, detail, layout, t);
  }
}

/** The file, search, fetch, text and unknown-tool details. */
function buildContentDetailSections(
  toolName: string | undefined,
  detail: ToolCallDetail,
  layout: DetailLayout,
  t: TFunction,
): ReactNode[] {
  switch (detail.type) {
    case "read":
      if (!detail.content) return [];
      return [
        <ScrollableTextSection
          key="read"
          content={detail.content}
          layout={layout}
          filePath={detail.filePath}
          startLine={detail.offset ?? 1}
        />,
      ];
    case "search":
      return buildSearchSections(detail, layout);
    case "fetch":
      return [
        <MonoBlock
          key="fetch"
          text={detail.result ? `${detail.url}\n\n${detail.result}` : detail.url}
          layout={layout}
        />,
      ];
    case "plain_text":
      if (!detail.text) return [];
      return [<PlainTextSection key="plain-text" text={detail.text} layout={layout} />];
    case "unknown": {
      const sections = toolName
        ? buildBySpaceToolDetailSections(toolName, detail.input, detail.output)
        : null;
      if (sections)
        return sections.map((section) => (
          <BySpaceDetailSection key={section.title} section={section} />
        ));
      return buildUnknownSections(detail, layout, t);
    }
    default:
      return [];
  }
}

function EditDetailSection({
  diffLines,
  layout,
}: {
  diffLines: DiffLine[] | undefined;
  layout: DetailLayout;
}) {
  return (
    <div className={cn("flex flex-col gap-2", layout.shouldFill && FILL)}>
      {diffLines ? (
        <div className={cn("overflow-hidden", layout.shouldFill && FILL)}>
          <DiffViewer
            diffLines={diffLines}
            maxHeight={layout.maxHeightStyle?.maxHeight as number | undefined}
            fillAvailableHeight={layout.shouldFill}
          />
        </div>
      ) : null}
    </div>
  );
}

function WriteDetailSection({
  content,
  filePath,
  layout,
}: {
  content: string | undefined;
  filePath: string;
  layout: DetailLayout;
}) {
  return (
    <div className={cn("flex flex-col gap-2", layout.shouldFill && FILL)}>
      {content ? (
        <ScrollableTextSection content={content} layout={layout} filePath={filePath} />
      ) : null}
    </div>
  );
}

function ErrorSection({ errorText }: { errorText: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-[0.5px] text-destructive uppercase">
        {t("toolCallDetails.error")}
      </span>
      <div className="overflow-x-auto">
        <pre className="tool-code w-max p-3 text-destructive! select-text" data-pmono="">
          {errorText}
        </pre>
      </div>
    </div>
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
}: {
  toolName?: string;
  detail?: ToolCallDetail;
  errorText?: string;
  maxHeight?: number;
  fillAvailableHeight?: boolean;
  showLoadingSkeleton?: boolean;
  /** Streaming content (thinking) keeps the scroll pinned to its newest lines. */
  followTail?: boolean;
}) {
  const { t } = useTranslation();
  const resolvedMaxHeight = fillAvailableHeight ? undefined : (maxHeight ?? 300);
  const shouldFill = resolveShouldFill(detail, fillAvailableHeight);
  const layout = useMemo<DetailLayout>(
    () => ({
      shouldFill,
      maxHeightStyle:
        resolvedMaxHeight !== undefined ? { maxHeight: resolvedMaxHeight } : undefined,
    }),
    [resolvedMaxHeight, shouldFill],
  );
  const diffLines = useDiffLines(detail);
  const isFullBleed =
    detail?.type === "edit" || detail?.type === "shell" || detail?.type === "write";
  const sections = buildSections({ toolName, detail, diffLines, layout, followTail, t });
  if (errorText) sections.push(<ErrorSection key="error" errorText={errorText} />);

  if (sections.length === 0) {
    if (showLoadingSkeleton) return <DetailSkeleton fill={fillAvailableHeight} />;
    return (
      <span className="text-sm text-muted-foreground italic">{t("toolCallDetails.empty")}</span>
    );
  }
  return (
    <div className={cn("flex flex-col", isFullBleed ? "gap-2" : "gap-4", shouldFill && FILL)}>
      {sections}
    </div>
  );
}

/**
 * Thinking renders its own section: while the block streams, its scroll area pins to the newest
 * lines instead of sitting at the top.
 */
function buildSections(input: {
  toolName: string | undefined;
  detail: ToolCallDetail | undefined;
  diffLines: DiffLine[] | undefined;
  layout: DetailLayout;
  followTail: boolean;
  t: TFunction;
}): ReactNode[] {
  const { toolName, detail, diffLines, layout, followTail, t } = input;
  if (toolName === "thinking" && detail?.type === "unknown" && typeof detail.input === "string") {
    return [
      <ThinkingDetailSection
        key="thinking"
        text={detail.input}
        layout={layout}
        followTail={followTail}
      />,
    ];
  }
  return buildDetailSections(toolName, detail, diffLines, layout, t);
}

function DetailSkeleton({ fill }: { fill: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 p-3", fill && FILL)}>
      <div className="h-3 w-full rounded-full bg-(--surface-3)" />
      <div className="h-3 w-[72%] rounded-full bg-(--surface-3)" />
      <div className="h-3 w-[48%] rounded-full bg-(--surface-3)" />
    </div>
  );
}
