// Port of archive/expo-app:packages/app/src/components/message.tsx: the conversation's rows — user message,
// assistant prose, tool calls, todo and custom-message badges, notifications, the compaction
// marker. Behaviour is the Expo file's (paced reveal, block splitting, file links, rewind and
// fork menus, the loading shimmer); the view is DOM, and the prose goes through web/src/markdown.
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import type MarkdownIt from "markdown-it";
import {
  Check,
  CheckSquare,
  CircleDot,
  Copy,
  FileSymlink,
  Info,
  MicVocal,
  Plus,
  Scissors,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import type { AgentAttachment } from "@bytetrue/protocol/messages";
import type { AgentCapabilityFlags, ToolCallDetail } from "@bytetrue/protocol/agent-types";
import { getAgentAttachmentPillContent } from "@/attachments/attachment-pill-content";
import {
  AssistantInlineCodePathLink,
  type AssistantFileLinkSource,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
  useAssistantFileLinkActions,
} from "@/assistant-file-links";
import { useAssistantImage } from "@/assistant-image/use-assistant-image";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "~/components/ui/marker";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "~/components/ui/trace";
import { Button } from "~/components/ui/button";
import { Message, MessageContent, MessageFooter, MessageHeader } from "~/components/ui/message";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "~/components/ui/attachment";
import { AssistantForkMenu, type AssistantForkTarget } from "@/components/assistant-fork-menu";
import {
  capAssistantMessageForRender,
  getUtf8ByteLength,
} from "@/components/assistant-message-render-limit";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { MarkdownFenceBlock } from "@/components/markdown/fence";
import type { MarkdownPhase } from "@/components/markdown/fence/types";
import { getCompactionMarkerLabel } from "@/components/message-compaction-label";
import { parseNotificationMessage } from "@/components/message-notification-parser";
import { PlanCard } from "@/components/plan-card";
import { RewindMenu, type RewindMode } from "@/components/rewind/rewind-menu";
import { useRewindAgentMutation } from "@/components/rewind/use-rewind-agent-mutation";
import { TaskListRow } from "@/components/task-list-row";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { useToolCallSheet } from "@/components/tool-call-sheet";
import {
  areToolCallPropsEqual,
  resolveJoinedSubagentRow,
  type ToolCallProps,
} from "@/components/tool-call-subagent-row";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useRevealedText } from "@/hooks/use-revealed-text";
import { buildToolCallPresentation } from "@/tool-calls/presentation";
import type { TaskActivity, TodoEntry, UserMessageImageAttachment } from "@/types/stream";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { setAssistantMarkdownBlockHeight } from "@/utils/assistant-message-height-estimate";
import { isRenderProfileEnabled } from "@/utils/render-profiler";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";
import { resolveToolCallIcon } from "@/utils/tool-call-icon";
import { cn } from "cn";
import { Spinner } from "~/components/ui/spinner";
import { markdownNodeText, parseMarkdownAst, type MarkdownAstNode } from "~/markdown/ast";
import { copyTag, MarkdownBody, type MarkdownRules } from "~/markdown/render";

export type { InlinePathTarget } from "@/assistant-file-links";
export type { AssistantForkTarget };
export type { ToolCallProps, ToolCallSubagentBinding } from "@/components/tool-call-subagent-row";
export { areToolCallPropsEqual } from "@/components/tool-call-subagent-row";

// Font size for stream metadata (timestamps, durations, live elapsed timer).
export const STREAM_METADATA_FONT_SIZE = 13;

const MessageOuterSpacingContext = createContext(false);

export function MessageOuterSpacingProvider({
  disableOuterSpacing,
  children,
}: {
  disableOuterSpacing: boolean;
  children: ReactNode;
}) {
  return (
    <MessageOuterSpacingContext value={disableOuterSpacing}>{children}</MessageOuterSpacingContext>
  );
}

function useDisableOuterSpacing(disableOuterSpacing: boolean | undefined) {
  const contextValue = useContext(MessageOuterSpacingContext);
  return disableOuterSpacing ?? contextValue;
}

const SCROLL_EDGE_EPSILON = 0.5;
type ScrollAxis = "x" | "y";

function getWheelEventElementTarget(event: WheelEvent, fallback: HTMLElement): HTMLElement {
  const { target } = event;
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return fallback;
}

function canElementScrollInDirection(
  element: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) return false;
  const computedStyle = window.getComputedStyle(element);
  const overflow = axis === "x" ? computedStyle.overflowX : computedStyle.overflowY;
  if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") return false;
  const scrollPosition = axis === "x" ? element.scrollLeft : element.scrollTop;
  const scrollSize =
    axis === "x"
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
  if (scrollSize <= SCROLL_EDGE_EPSILON) return false;
  if (delta > 0) return scrollPosition < scrollSize - SCROLL_EDGE_EPSILON;
  return scrollPosition > SCROLL_EDGE_EPSILON;
}

function canScrollInsideDetailFromTarget(
  detailRoot: HTMLElement,
  startElement: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) return false;
  let current: HTMLElement | null = startElement;
  while (current) {
    if (canElementScrollInDirection(current, axis, delta)) return true;
    if (current === detailRoot) break;
    current = current.parentElement;
  }
  return false;
}

/** A wheel that can scroll something inside an open tool call stays there instead of moving the chat. */
function shouldStopDetailWheelPropagation(detailRoot: HTMLElement, event: WheelEvent): boolean {
  const startElement = getWheelEventElementTarget(event, detailRoot);
  const verticalDelta = event.deltaY;
  let horizontalDelta = 0;
  if (event.deltaX !== 0) horizontalDelta = event.deltaX;
  else if (event.shiftKey) horizontalDelta = event.deltaY;
  const hasVerticalIntent = Math.abs(verticalDelta) > SCROLL_EDGE_EPSILON;
  const hasHorizontalIntent = Math.abs(horizontalDelta) > SCROLL_EDGE_EPSILON;
  if (!hasVerticalIntent && !hasHorizontalIntent) return false;
  const canScrollVertically = hasVerticalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "y", verticalDelta)
    : false;
  const canScrollHorizontally = hasHorizontalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "x", horizontalDelta)
    : false;
  if (hasVerticalIntent && hasHorizontalIntent) {
    return Math.abs(verticalDelta) >= Math.abs(horizontalDelta)
      ? canScrollVertically || canScrollHorizontally
      : canScrollHorizontally || canScrollVertically;
  }
  return hasVerticalIntent ? canScrollVertically : canScrollHorizontally;
}

// ---- Copy ----

export const TurnCopyButton = memo(function TurnCopyButton({
  getContent,
  className,
  accessibilityLabel,
  copiedAccessibilityLabel,
}: {
  getContent: () => string;
  className?: string;
  accessibilityLabel?: string;
  copiedAccessibilityLabel?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(async () => {
    const content = getContent();
    if (!content) return;
    await writeMarkdownToRichClipboard(content, getDefaultMarkdownClipboardEnvironment());
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }, [getContent]);
  useEffect(
    () => () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    },
    [],
  );
  let label = accessibilityLabel ?? t("message.actions.copyTurn");
  if (copied) label = copiedAccessibilityLabel ?? t("message.actions.copied");
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      aria-label={label}
      className={className}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
});

// ---- User message ----

function UserImageAttachment({
  image,
  onOpen,
}: {
  image: UserMessageImageAttachment;
  onOpen: (image: UserMessageImageAttachment) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpen(image), [image, onOpen]);
  const previewUrl = useAttachmentPreviewUrl(image);
  return (
    <Attachment size="sm" orientation="vertical">
      <AttachmentTrigger onClick={handlePress} aria-label={t("composer.attachments.openImage")} />
      <AttachmentMedia variant="image">
        {previewUrl ? <img src={previewUrl} alt="" /> : null}
      </AttachmentMedia>
    </Attachment>
  );
}

interface UserMessageProps {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  message: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  timestamp: number;
  capabilities?: AgentCapabilityFlags;
  client?: DaemonClient | null;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  isPending?: boolean;
  disableOuterSpacing?: boolean;
}

function userMessageSpacing(isFirstInGroup: boolean, isLastInGroup: boolean): string {
  // Later entries win, as in the React Native style array: a run's inner edges get 4px.
  if (!isFirstInGroup || !isLastInGroup) return cn(isFirstInGroup && "mt-4", "mb-1");
  return "mt-4 mb-4";
}

export const UserMessage = memo(function UserMessage({
  serverId,
  agentId,
  messageId,
  message,
  images = [],
  attachments = [],
  timestamp,
  capabilities,
  client,
  isFirstInGroup = true,
  isLastInGroup = true,
  isPending = false,
  disableOuterSpacing,
}: UserMessageProps) {
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [lightboxMetadata, setLightboxMetadata] = useState<UserMessageImageAttachment | null>(null);
  const handleLightboxClose = useCallback(() => setLightboxMetadata(null), []);
  const handleBubbleEnter = useCallback(() => setIsHovered(true), []);
  const handleBubbleLeave = useCallback(() => setIsHovered(false), []);
  const lightboxSource = useMemo<ImageLightboxSource | null>(
    () => (lightboxMetadata ? { type: "attachment", metadata: lightboxMetadata } : null),
    [lightboxMetadata],
  );
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const hasText = message.trim().length > 0;
  const hasImages = images.length > 0;
  const hasAttachments = attachments.length > 0;
  const showTrailingRow = !isPending && hasText && (isCompact || isHovered);
  const formattedTimestamp = useMemo(
    () => formatMessageTimestamp(new Date(timestamp)),
    [timestamp],
  );
  const rewindMutation = useRewindAgentMutation({ serverId, agentId, client, messageId });
  const getMessageContent = useCallback(() => message, [message]);
  const handleRewind = useCallback(
    (input: { mode: RewindMode; rewoundText: string }) => rewindMutation.rewindAgent(input),
    [rewindMutation],
  );

  return (
    <Message
      align="end"
      className={cn(
        "select-text",
        !resolvedDisableOuterSpacing && userMessageSpacing(isFirstInGroup, isLastInGroup),
      )}
      data-testid="user-message"
      aria-busy={isPending}
    >
      <MessageContent onPointerEnter={handleBubbleEnter} onPointerLeave={handleBubbleLeave}>
        {hasImages ? (
          <AttachmentGroup>
            {images.map((image) => (
              <UserImageAttachment key={image.id} image={image} onOpen={setLightboxMetadata} />
            ))}
          </AttachmentGroup>
        ) : null}
        {hasAttachments ? (
          <AttachmentGroup>
            {attachments.map((attachment, index) => {
              const content = getAgentAttachmentPillContent(attachment, t);
              return (
                <Attachment
                  key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
                  size="sm"
                >
                  <AttachmentMedia>{content.icon}</AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{content.title}</AttachmentTitle>
                    <AttachmentDescription>{content.subtitle}</AttachmentDescription>
                  </AttachmentContent>
                </Attachment>
              );
            })}
          </AttachmentGroup>
        ) : null}
        {hasText ? (
          <Bubble variant="muted" align="end">
            <BubbleContent className="whitespace-pre-wrap">{message}</BubbleContent>
          </Bubble>
        ) : null}
        {hasText ? (
          <MessageFooter
            className={cn(
              "gap-2 font-normal",
              showTrailingRow ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            data-testid="user-message-trailing-row"
          >
            <span data-testid="user-message-timestamp">{formattedTimestamp}</span>
            {capabilities && messageId ? (
              <RewindMenu
                capabilities={capabilities}
                isPending={rewindMutation.isPending}
                rewoundText={message}
                onRewind={handleRewind}
              />
            ) : null}
            <TurnCopyButton
              getContent={getMessageContent}
              accessibilityLabel={t("message.actions.copyMessage")}
            />
          </MessageFooter>
        ) : null}
      </MessageContent>
      <AttachmentLightbox source={lightboxSource} onClose={handleLightboxClose} />
    </Message>
  );
});

// ---- Assistant turn footer ----

/**
 * Footer next to the copy button at the end of an assistant turn: the turn's duration, swapped
 * for its end time on hover. A turn without a visible start shows its end time directly.
 */
export const AssistantTurnFooter = memo(function AssistantTurnFooter({
  getContent,
  completedAt,
  durationMs,
  onFork,
}: {
  getContent: () => string;
  completedAt?: Date;
  durationMs?: number | null;
  onFork?: (target: AssistantForkTarget) => Promise<void> | void;
}) {
  const durationLabel = useMemo(
    () =>
      durationMs !== undefined && durationMs !== null
        ? `Worked for ${formatDuration(durationMs)}`
        : "",
    [durationMs],
  );
  const timestampLabel = useMemo(
    () => (completedAt ? formatMessageTimestamp(completedAt) : ""),
    [completedAt],
  );
  const handleFork = useCallback((target: AssistantForkTarget) => onFork?.(target), [onFork]);
  return (
    <MessageFooter className="gap-1 px-0 font-normal">
      <TurnCopyButton getContent={getContent} />
      {onFork ? <AssistantForkMenu onFork={handleFork} /> : null}
      {durationLabel && timestampLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="xs" className="font-normal text-muted-foreground">
              {durationLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{timestampLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <span>{durationLabel || timestampLabel}</span>
      )}
    </MessageFooter>
  );
});

/** Ticks every second; isolated so only it re-renders on each tick. */
export const LiveElapsed = memo(function LiveElapsed({
  startedAt,
  active = true,
  className,
  style,
  testID,
}: {
  startedAt: Date;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
  testID?: string;
}) {
  const startedAtMs = startedAt.getTime();
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAtMs));
  const visibleElapsedMs = active ? Math.max(0, Date.now() - startedAtMs) : elapsedMs;
  useEffect(() => {
    if (!active) return;
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const handle = setInterval(() => setElapsedMs(Math.max(0, Date.now() - startedAtMs)), 1000);
    return () => clearInterval(handle);
  }, [active, startedAtMs]);
  return (
    <span className={className} style={style} data-testid={testID}>
      {formatDuration(visibleElapsedMs)}
    </span>
  );
});

// ---- Assistant message ----

const ASSISTANT_IMAGE_MIN_HEIGHT = 160;

function AssistantMarkdownImage({
  source,
  occurrenceKey,
  alt,
  hasLeadingContent,
  client,
  workspaceRoot,
  serverId,
}: {
  source: string;
  occurrenceKey: string;
  alt?: string;
  hasLeadingContent: boolean;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
}) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const closeViewer = useCallback(() => setViewerOpen(false), []);
  const openViewer = useCallback(() => setViewerOpen(true), []);
  const image = useAssistantImage({ source, occurrenceKey, client, workspaceRoot, serverId });
  const binding = image.status === "failed" ? null : image.binding;
  const aspectRatio = image.status === "failed" ? null : image.aspectRatio;
  const imageUri = binding?.uri ?? "";
  const surfaceStyle = useMemo<CSSProperties>(
    () => (aspectRatio ? { aspectRatio } : { height: ASSISTANT_IMAGE_MIN_HEIGHT }),
    [aspectRatio],
  );
  const lightboxSource = useMemo<ImageLightboxSource | null>(() => {
    if (!viewerOpen || !imageUri) return null;
    return {
      type: "uri",
      uri: imageUri,
      contentSize: aspectRatio ? { width: aspectRatio, height: 1 } : undefined,
    };
  }, [aspectRatio, imageUri, viewerOpen]);
  const frame = cn("-mx-1 min-h-40 w-full", hasLeadingContent && "mt-4");
  if (image.status === "failed") {
    return (
      <div className={cn(frame, "flex h-40 flex-col items-center justify-center gap-2 px-4 py-6")}>
        <span className="text-center text-sm text-muted-foreground">{image.message}</span>
      </div>
    );
  }
  if (!binding) {
    return (
      <div className={cn(frame, "flex h-40 flex-col items-center justify-center gap-2 px-4 py-6")}>
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className={frame}>
      <button
        type="button"
        aria-label={t("composer.attachments.openImage")}
        disabled={image.status !== "loaded"}
        onClick={openViewer}
        className="relative block w-full overflow-hidden"
        style={surfaceStyle}
      >
        <span ref={binding.onRef} role="img" aria-label={alt} className="block size-full">
          <img
            src={imageUri}
            alt=""
            onLoad={binding.onLoad}
            onError={binding.onError}
            className="size-full object-contain"
          />
        </span>
        {image.status === "loading" ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </span>
        ) : null}
      </button>
      <AttachmentLightbox source={lightboxSource} onClose={closeViewer} />
    </div>
  );
}

function getInlineCodeAutoLinkUrl(markdownParser: MarkdownIt, content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const matches = markdownParser.linkify.match(trimmed) as
    | { index: number; lastIndex: number; url: string }[]
    | null;
  if (!matches || matches.length !== 1) return null;
  const [match] = matches;
  if (!match || match.index !== 0 || match.lastIndex !== trimmed.length) return null;
  return match.url;
}

function getMarkdownLinkSource(node: MarkdownAstNode): AssistantFileLinkSource {
  return {
    href: node.attributes.href ?? "",
    text: markdownNodeText(node),
    title: node.attributes.title,
    markup: node.markup,
    sourceInfo: node.sourceInfo,
    sourceType: node.sourceType === "inline-code" ? "inline-code" : undefined,
  };
}

function AutoLinkedInlineCode({ href, content }: { href: string; content: string }) {
  const source = useMemo<AssistantFileLinkSource>(
    () => ({ href, text: content, markup: "linkify", sourceInfo: "auto" }),
    [content, href],
  );
  return <AssistantMarkdownCodeLink source={source}>{content}</AssistantMarkdownCodeLink>;
}

/** Records each rendered block's height, which the stream uses to estimate unmeasured rows. */
function AssistantMessageBlockContainer({
  block,
  marginBottom,
  children,
}: {
  block: string;
  marginBottom: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setAssistantMarkdownBlockHeight({ block, width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [block]);
  const style = useMemo(() => (marginBottom > 0 ? { marginBottom } : undefined), [marginBottom]);
  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}

const MemoizedMarkdownBlock = memo(function MemoizedMarkdownBlock({
  text,
  rules,
  parser,
}: {
  text: string;
  rules: MarkdownRules;
  parser: MarkdownIt;
}) {
  const nodes = useMemo(() => parseMarkdownAst(text, parser), [parser, text]);
  return <MarkdownBody nodes={nodes} rules={rules} />;
});

export const AssistantMessage = memo(function AssistantMessage({
  occurrenceKey,
  message,
  timestamp: _timestamp,
  workspaceRoot,
  serverId,
  client,
  spacing = "default",
  phase,
}: {
  occurrenceKey: string;
  message: string;
  timestamp: number;
  workspaceRoot?: string;
  serverId?: string;
  client?: DaemonClient | null;
  spacing?: "default" | "compactTop" | "compactBottom" | "compactBoth";
  phase: MarkdownPhase;
}) {
  const { t } = useTranslation();
  const markdownParser = useMemo(createAssistantMarkdownParser, []);
  const renderedMessage = useMemo(() => capAssistantMessageForRender(message), [message]);
  // Paint a paced prefix while the turn is streaming so text arrives at a steady
  // rate instead of in whatever lumps the daemon's coalescing window produced.
  const revealedMessage = useRevealedText(renderedMessage.text, phase);
  const fullMessageByteLength = useMemo(
    () => (renderedMessage.capped && phase === "complete" ? getUtf8ByteLength(message) : null),
    [message, phase, renderedMessage.capped],
  );
  const fileLinkActions = useAssistantFileLinkActions();

  const markdownRules = useMemo<MarkdownRules>(
    () => ({
      code_block: (node) => (
        <HighlightedCodeBlock
          key={node.key}
          code={node.content}
          language={null}
          variant="code_block"
        />
      ),
      fence: (node) => (
        <MarkdownFenceBlock
          key={node.key}
          code={node.content}
          info={node.sourceInfo}
          phase={phase}
        />
      ),
      code_inline: (node, _children, parents) => {
        const content = node.content ?? "";
        const isLinkedInlineCode = parents.some((parent) => parent.type === "link");
        const inlineCodeSource: AssistantFileLinkSource = {
          href: content,
          text: content,
          sourceType: "inline-code",
        };
        if (!isLinkedInlineCode && fileLinkActions.canResolveFile(inlineCodeSource)) {
          return <AssistantInlineCodePathLink key={node.key} content={content} />;
        }
        const inlineCodeLinkUrl = getInlineCodeAutoLinkUrl(markdownParser, content);
        if (inlineCodeLinkUrl) {
          return <AutoLinkedInlineCode key={node.key} href={inlineCodeLinkUrl} content={content} />;
        }
        return (
          <code key={node.key} data-pmono="" {...copyTag("code")}>
            {content}
          </code>
        );
      },
      link: (node, children) => (
        <AssistantMarkdownLink key={node.key} source={getMarkdownLinkSource(node)}>
          {children}
        </AssistantMarkdownLink>
      ),
      blocklink: (node, children) => (
        <AssistantMarkdownLink key={node.key} source={getMarkdownLinkSource(node)}>
          {children}
        </AssistantMarkdownLink>
      ),
      image: (node, _children, parents) => {
        const src = node.attributes.src ?? "";
        const paragraph = parents.find((ancestor) => ancestor.type === "paragraph");
        const imageIndex = paragraph
          ? paragraph.children.findIndex((child) => child.key === node.key)
          : -1;
        return (
          <AssistantMarkdownImage
            key={node.key}
            source={src}
            occurrenceKey={`${occurrenceKey}:${node.key}`}
            alt={node.attributes.alt}
            hasLeadingContent={imageIndex > 0}
            client={client}
            workspaceRoot={workspaceRoot}
            serverId={serverId}
          />
        );
      },
    }),
    [client, fileLinkActions, markdownParser, occurrenceKey, phase, serverId, workspaceRoot],
  );
  const blocks = useMemo(() => splitMarkdownBlocks(revealedMessage), [revealedMessage]);
  const keyedBlocks = useMemo(
    () => blocks.map((block, index) => ({ key: `block:${index}`, block })),
    [blocks],
  );
  const revealData = isRenderProfileEnabled()
    ? { "data-reveal-key": occurrenceKey, "data-reveal-length": String(revealedMessage.length) }
    : undefined;
  return (
    <Message
      data-testid="assistant-message"
      {...revealData}
      className={cn(
        "py-3 select-text",
        (spacing === "compactTop" || spacing === "compactBoth") && "pt-0",
        (spacing === "compactBottom" || spacing === "compactBoth") && "pb-0",
      )}
    >
      <MessageContent className="gap-0">
        {keyedBlocks.map(({ key, block }, index) => (
          <AssistantMessageBlockContainer
            key={key}
            block={block}
            marginBottom={index < keyedBlocks.length - 1 ? 12 : 0}
          >
            <MemoizedMarkdownBlock text={block} rules={markdownRules} parser={markdownParser} />
          </AssistantMessageBlockContainer>
        ))}
        {fullMessageByteLength !== null ? (
          <span
            data-testid="assistant-message-capped-notice"
            className="mt-3 text-sm text-muted-foreground italic"
          >
            {t("agentStream.messageCapped", { bytes: fullMessageByteLength })}
          </span>
        ) : null}
      </MessageContent>
    </Message>
  );
});

// ---- Speak, notification, custom message, compaction ----

export const SpeakMessage = memo(function SpeakMessage({
  message,
  timestamp: _timestamp,
  disableOuterSpacing,
}: {
  message: string;
  timestamp: number;
  disableOuterSpacing?: boolean;
}) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  return (
    <Message
      data-testid="speak-message"
      className={cn("py-3", !resolvedDisableOuterSpacing && "mb-4")}
    >
      <MessageContent>
        <MessageHeader className="gap-2 px-0 font-normal">
          <MicVocal className="size-3" />
          {t("message.speak.header")}
        </MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="whitespace-pre-wrap">{message}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
});

const NOTIFICATION_ICONS = {
  info: <Info />,
  warning: <TriangleAlert className="text-status-warning" />,
  error: <XCircle />,
} as const;

export const Notification = memo(function Notification({
  level,
  message,
  disableOuterSpacing,
}: {
  level: "info" | "warning" | "error";
  message: string;
  disableOuterSpacing?: boolean;
}) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const parsed = useMemo(() => parseNotificationMessage(message), [message]);
  const bodyText = parsed.body || (!parsed.title ? message : null);
  return (
    <Alert
      variant={level === "error" ? "destructive" : "default"}
      data-testid="timeline-notification"
      className={cn("select-text", !resolvedDisableOuterSpacing && "mb-2")}
    >
      {NOTIFICATION_ICONS[level]}
      {parsed.title ? (
        <AlertTitle data-testid="notification-title">{parsed.title}</AlertTitle>
      ) : null}
      {bodyText ? (
        <AlertDescription className="whitespace-pre-wrap" data-testid="notification-body">
          {bodyText}
        </AlertDescription>
      ) : null}
    </Alert>
  );
});

function customMessagePreview(content: string): string {
  const newlineIndex = content.indexOf("\n");
  return (newlineIndex === -1 ? content : content.slice(0, newlineIndex)).trim();
}

/**
 * Extension-injected custom messages (Pi sendMessage / OMP custom) in the tool-call badge shell,
 * so they read as one more timeline entry and never as the agent's own words.
 */
export const CustomMessage = memo(function CustomMessage({
  customType,
  content,
  disableOuterSpacing,
}: {
  customType: string;
  content: string;
  disableOuterSpacing?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);
  const secondaryLabel = useMemo(() => customMessagePreview(content), [content]);
  const renderDetails = useCallback(
    () => (
      <div className="p-2">
        <pre className="font-mono text-(length:--code-font-size) leading-[18px] whitespace-pre-wrap text-foreground select-text">
          {content}
        </pre>
      </div>
    ),
    [content],
  );
  return (
    <ExpandableBadge
      testID="custom-message-badge"
      label={customType}
      secondaryLabel={secondaryLabel}
      icon={Info}
      isExpanded={expanded}
      onToggle={toggleExpanded}
      renderDetails={renderDetails}
      disableOuterSpacing={disableOuterSpacing}
    />
  );
});

export const CompactionMarker = memo(function CompactionMarker({
  status,
  trigger,
  preTokens,
}: {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}) {
  const label = getCompactionMarkerLabel({ status, trigger, preTokens });
  return (
    <Marker variant="separator" className="px-4 py-3">
      <MarkerIcon>{status === "loading" ? <Spinner /> : <Scissors />}</MarkerIcon>
      <MarkerContent>{label}</MarkerContent>
    </Marker>
  );
});

function taskActivityIcon(activity: TaskActivity) {
  switch (activity.type) {
    case "added":
      return Plus;
    case "started":
      return CircleDot;
    case "completed":
      return Check;
    default:
      return CheckSquare;
  }
}

export const TodoListCard = memo(function TodoListCard({
  items,
  activity,
  disableOuterSpacing,
}: {
  items: TodoEntry[];
  activity: TaskActivity;
  disableOuterSpacing?: boolean;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const activityDisplay = useMemo(() => {
    if (activity.type === "created") {
      return {
        label: t("message.todo.activity.created", { count: activity.count }),
        secondaryLabel: undefined,
      };
    }
    return { label: t(`message.todo.activity.${activity.type}`), secondaryLabel: activity.task };
  }, [activity, t]);
  const handleToggle = useCallback(() => setIsExpanded((prev) => !prev), []);
  const renderDetails = useCallback(
    () => (
      <div className="p-2">
        <div className="flex flex-col gap-1">
          {items.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("message.todo.empty")}</span>
          ) : (
            items.map((item) => <TaskListRow key={item.id ?? item.text} task={item} />)
          )}
        </div>
      </div>
    ),
    [items, t],
  );
  return (
    <ExpandableBadge
      label={activityDisplay.label}
      secondaryLabel={activityDisplay.secondaryLabel}
      icon={taskActivityIcon(activity)}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      renderDetails={renderDetails}
      disableOuterSpacing={disableOuterSpacing}
    />
  );
});

// ---- Expandable badge (tool calls, todos, custom messages) ----

interface ExpandableBadgeProps {
  label: string;
  secondaryLabel?: string;
  icon?: ComponentType<{ size?: number; color?: string }>;
  isExpanded: boolean;
  className?: string;
  onToggle?: () => void;
  onOpenFile?: () => void;
  onDetailHoverChange?: (hovered: boolean) => void;
  renderDetails?: () => ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  testID?: string;
}

export const ExpandableBadge = memo(function ExpandableBadge({
  label,
  className,
  secondaryLabel,
  icon: Icon,
  isExpanded,
  onToggle,
  onOpenFile,
  onDetailHoverChange,
  renderDetails,
  isLoading = false,
  isError = false,
  isLastInSequence = false,
  disableOuterSpacing,
  testID,
}: ExpandableBadgeProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const detailContent = renderDetails && isExpanded ? renderDetails() : null;
  const detailWrapperRef = useRef<HTMLDivElement | null>(null);

  // A detail that scrolls keeps the wheel; otherwise the timeline scrolls.
  useEffect(() => {
    const node = detailWrapperRef.current;
    if (!node || !detailContent) return;
    const stopWheelPropagation = (event: WheelEvent) => {
      if (shouldStopDetailWheelPropagation(node, event)) event.stopPropagation();
    };
    node.addEventListener("wheel", stopWheelPropagation, { passive: true });
    return () => node.removeEventListener("wheel", stopWheelPropagation);
  }, [detailContent]);

  const handleDetailPointerEnter = useCallback(
    () => onDetailHoverChange?.(true),
    [onDetailHoverChange],
  );
  const handleDetailPointerLeave = useCallback(
    () => onDetailHoverChange?.(false),
    [onDetailHoverChange],
  );
  const handleOpenChange = useCallback(() => onToggle?.(), [onToggle]);

  let leadingIcon: ReactNode = null;
  if (isError) leadingIcon = <TriangleAlert />;
  else if (Icon) leadingIcon = <Icon />;
  let status: "running" | "error" | undefined;
  if (isLoading) status = "running";
  else if (isError) status = "error";
  const line = (
    <TraceLine status={status} className={cn("flex-1 gap-2.5", onOpenFile && onToggle && "pr-6")}>
      <TraceIcon>{leadingIcon}</TraceIcon>
      <TraceTitle
        className={cn(
          "shrink-0 font-medium text-foreground/80 in-data-[status=error]:text-destructive",
          secondaryLabel && "min-w-20",
        )}
      >
        {label}
      </TraceTitle>
      {secondaryLabel ? (
        <TraceDescription className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {secondaryLabel}
        </TraceDescription>
      ) : null}
    </TraceLine>
  );
  const openFileButton = onOpenFile ? (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onOpenFile}
      aria-label={t("message.actions.openFile")}
      data-testid="tool-call-open-file"
      className={cn(
        onToggle &&
          "absolute right-6 md:opacity-0 md:group-focus-within/trace-row:opacity-100 md:group-hover/trace-row:opacity-100",
      )}
    >
      <FileSymlink />
    </Button>
  ) : null;

  return (
    <Trace
      data-testid={testID}
      className={cn(
        "*:has-[>[data-slot=trace-line]]:w-full",
        !resolvedDisableOuterSpacing && (isLastInSequence ? "mb-4" : "mb-1"),
        className,
      )}
    >
      {onToggle ? (
        <TraceCollapsible open={isExpanded} onOpenChange={handleOpenChange}>
          {/* -mx-2 + px-2 grows the hover surface into CONTENT_COLUMN's gutter without moving the
              leading icon or trailing chevron off the prose's left/right rails; -mr-1 on the
              chevron is an optical nudge for ChevronRight's internal viewBox inset. */}
          <div className="group/trace-row relative -mx-2 flex w-[calc(100%+16px)] min-w-0 items-center">
            <TraceCollapsibleTrigger className="w-full flex-1 justify-between gap-2 rounded-lg px-2 py-1.5 group-hover/trace-row:bg-muted/50 hover:bg-muted/50 [&>[data-slot=trace-icon]]:-mr-1">
              {line}
            </TraceCollapsibleTrigger>
            {openFileButton}
          </div>
          <TraceCollapsibleContent
            ref={detailWrapperRef}
            onPointerEnter={handleDetailPointerEnter}
            onPointerLeave={handleDetailPointerLeave}
            className="select-text"
          >
            {detailContent}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        <div className="-mx-2 flex w-[calc(100%+16px)] min-w-0 items-center gap-1 px-2 py-1.5">
          {line}
          {openFileButton}
        </div>
      )}
    </Trace>
  );
});

// ---- Tool call ----

export const ToolCall = memo(function ToolCall({
  toolName,
  args,
  result,
  error,
  status,
  detail,
  cwd,
  metadata,
  summaryOverride,
  subagent,
  isLastInSequence = false,
  disableOuterSpacing,
  onInlineDetailsHoverChange,
  onOpenFilePath,
  defaultExpanded,
  forceInline = false,
  maxDetailHeight = 400,
  followTail = false,
}: ToolCallProps) {
  const { openToolCall } = useToolCallSheet();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false);
  const isMobile = useIsCompactFormFactor();
  const shouldRenderInline = !isMobile || forceInline;
  const effectiveDetail = useMemo<ToolCallDetail | undefined>(() => {
    if (detail) return detail;
    if (args !== undefined || result !== undefined) {
      return { type: "unknown", input: args ?? null, output: result ?? null };
    }
    return undefined;
  }, [detail, args, result]);
  const presentation = useMemo(
    () =>
      buildToolCallPresentation({
        toolName,
        status,
        error: error ?? null,
        detail: effectiveDetail,
        metadata,
        cwd,
        resolveIcon: resolveToolCallIcon,
      }),
    [toolName, status, error, effectiveDetail, metadata, cwd],
  );
  const handleOpenFile = useMemo(() => {
    const openFilePath = presentation.openFilePath;
    if (!openFilePath || !onOpenFilePath) return undefined;
    return () => onOpenFilePath(openFilePath);
  }, [presentation.openFilePath, onOpenFilePath]);
  const handleToggle = useCallback(() => {
    if (!shouldRenderInline) {
      openToolCall({
        toolName,
        displayName: presentation.displayName,
        summary: presentation.summary,
        detail: effectiveDetail,
        errorText: presentation.errorText,
        icon: presentation.icon,
        showLoadingSkeleton: presentation.isLoadingDetails,
      });
    } else {
      setIsExpanded((prev) => !prev);
    }
  }, [shouldRenderInline, openToolCall, toolName, presentation, effectiveDetail]);
  useEffect(() => {
    if (!onInlineDetailsHoverChange || !shouldRenderInline || isExpanded) return;
    onInlineDetailsHoverChange(false);
  }, [isExpanded, shouldRenderInline, onInlineDetailsHoverChange]);
  const renderDetails = useCallback(() => {
    if (!shouldRenderInline) return null;
    return (
      <ToolCallDetailsContent
        toolName={toolName}
        detail={effectiveDetail}
        errorText={presentation.errorText}
        maxHeight={maxDetailHeight}
        showLoadingSkeleton={presentation.isLoadingDetails}
        followTail={followTail}
      />
    );
  }, [
    shouldRenderInline,
    toolName,
    effectiveDetail,
    presentation.errorText,
    presentation.isLoadingDetails,
    maxDetailHeight,
    followTail,
  ]);
  const joinedRow = resolveJoinedSubagentRow(
    subagent,
    status,
    presentation.canOpenDetails,
    handleToggle,
  );
  const secondaryLabel = subagent?.secondaryLabel ?? summaryOverride ?? presentation.summary;
  if (presentation.isPlan && effectiveDetail?.type === "plan") {
    return (
      <PlanCard
        text={effectiveDetail.text}
        testID="timeline-plan-card"
        disableOuterSpacing={disableOuterSpacing}
      />
    );
  }
  return (
    <ExpandableBadge
      testID="tool-call-badge"
      label={presentation.displayName}
      secondaryLabel={secondaryLabel}
      icon={presentation.icon}
      isExpanded={shouldRenderInline && isExpanded && !subagent}
      onToggle={joinedRow.handlePress}
      onOpenFile={handleOpenFile}
      renderDetails={
        presentation.canOpenDetails && shouldRenderInline && !subagent ? renderDetails : undefined
      }
      isLoading={joinedRow.isLoading}
      isError={joinedRow.isError}
      isLastInSequence={isLastInSequence}
      disableOuterSpacing={disableOuterSpacing}
      onDetailHoverChange={onInlineDetailsHoverChange}
    />
  );
}, areToolCallPropsEqual);
