// Port of packages/app/src/components/message.tsx: the conversation's rows — user message,
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
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type MarkdownIt from "markdown-it";
import {
  Check,
  CheckSquare,
  ChevronRight,
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
import {
  AttachmentFrame,
  AttachmentLabel,
  AttachmentThumbnail,
} from "@/components/attachment-pill";
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
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className={cn(
        "mt-2 self-start p-2 pt-0 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
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
  return (
    <AttachmentFrame onPress={handlePress} accessibilityLabel={t("composer.attachments.openImage")}>
      <AttachmentThumbnail metadata={image} />
    </AttachmentFrame>
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
    <div
      className={cn(
        "flex justify-end select-text",
        !resolvedDisableOuterSpacing && userMessageSpacing(isFirstInGroup, isLastInGroup),
      )}
      data-testid="user-message"
      aria-busy={isPending}
    >
      <div
        className="flex max-w-full cursor-auto flex-col items-end"
        onPointerEnter={handleBubbleEnter}
        onPointerLeave={handleBubbleLeave}
      >
        <div className="flex min-w-0 shrink flex-col rounded-xl bg-muted px-3 py-2">
          {hasImages ? (
            <div className={cn("flex flex-wrap gap-2", (hasText || hasAttachments) && "mb-2")}>
              {images.map((image) => (
                <UserImageAttachment key={image.id} image={image} onOpen={setLightboxMetadata} />
              ))}
            </div>
          ) : null}
          {hasAttachments ? (
            <div className={cn("flex flex-wrap gap-2", hasText && "mb-2")}>
              {attachments.map((attachment, index) => {
                const content = getAgentAttachmentPillContent(attachment, t);
                return (
                  <AttachmentFrame
                    key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
                  >
                    <AttachmentLabel
                      icon={content.icon}
                      title={content.title}
                      subtitle={content.subtitle}
                    />
                  </AttachmentFrame>
                );
              })}
            </div>
          ) : null}
          {hasText ? (
            <span className="text-(length:--content-font-size) leading-[round(calc(var(--content-font-size)*1.4),1px)] wrap-anywhere whitespace-pre-wrap text-foreground">
              {message}
            </span>
          ) : null}
        </div>
        {hasText ? (
          <div
            className={cn(
              "mt-2 flex h-6 items-center gap-2 self-end",
              showTrailingRow ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            data-testid="user-message-trailing-row"
          >
            <span
              className="text-[13px] text-muted-foreground"
              data-testid="user-message-timestamp"
            >
              {formattedTimestamp}
            </span>
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
              className="mt-0 -mr-1 self-center p-1"
              accessibilityLabel={t("message.actions.copyMessage")}
            />
          </div>
        ) : null}
      </div>
      <AttachmentLightbox source={lightboxSource} onClose={handleLightboxClose} />
    </div>
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
  const [hovered, setHovered] = useState(false);
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
  const primaryLabel = durationLabel || timestampLabel;
  const canSwap = Boolean(durationLabel && timestampLabel);
  const showTimestamp = canSwap && hovered;
  const handleFork = useCallback((target: AssistantForkTarget) => onFork?.(target), [onFork]);
  const handleLabelEnter = useCallback(() => setHovered(true), []);
  const handleLabelLeave = useCallback(() => setHovered(false), []);
  return (
    <div className="flex items-center gap-2">
      <TurnCopyButton getContent={getContent} className="mt-0 -ml-1 self-center p-1" />
      {onFork ? <AssistantForkMenu onFork={handleFork} /> : null}
      {primaryLabel ? (
        <span
          role={canSwap ? "button" : undefined}
          aria-label={canSwap ? `${durationLabel}, ended ${timestampLabel}` : primaryLabel}
          onPointerEnter={handleLabelEnter}
          onPointerLeave={handleLabelLeave}
          className="relative text-[13px] text-muted-foreground"
        >
          {/* The sizer reserves the longer label, so the row keeps its width when they swap. */}
          <span className="opacity-0" aria-hidden="true">
            {primaryLabel.length >= timestampLabel.length ? primaryLabel : timestampLabel}
          </span>
          <span className="absolute top-0 left-0 whitespace-nowrap">
            {showTimestamp ? timestampLabel : primaryLabel}
          </span>
        </span>
      ) : null}
    </div>
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
    <div
      data-testid="assistant-message"
      {...revealData}
      className={cn(
        "flex flex-col py-3 select-text",
        (spacing === "compactTop" || spacing === "compactBoth") && "pt-0",
        (spacing === "compactBottom" || spacing === "compactBoth") && "pb-0",
      )}
    >
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
    </div>
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
    <div data-testid="speak-message" className={cn("py-3", !resolvedDisableOuterSpacing && "mb-4")}>
      <div className="mb-2 flex items-center gap-2">
        <MicVocal size={12} className="text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("message.speak.header")}</span>
      </div>
      <p className="text-(length:--content-font-size) leading-[round(calc(var(--content-font-size)*1.4),1px)] whitespace-pre-wrap text-foreground">
        {message}
      </p>
    </div>
  );
});

const NOTIFICATION_LEVELS = {
  info: {
    frame: "bg-[rgba(59,130,246,0.08)] border-[rgba(59,130,246,0.25)]",
    icon: <Info size={16} className="text-blue-300" />,
  },
  warning: {
    frame: "bg-[rgba(245,158,11,0.08)] border-[rgba(245,158,11,0.25)]",
    icon: <TriangleAlert size={16} className="text-amber-500" />,
  },
  error: {
    frame: "bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)]",
    icon: <XCircle size={16} className="text-destructive" />,
  },
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
  const config = NOTIFICATION_LEVELS[level];
  const bodyText = parsed.body || (!parsed.title ? message : null);
  return (
    <div
      role="alert"
      data-testid="timeline-notification"
      className={cn(
        "overflow-hidden rounded-lg border",
        !resolvedDisableOuterSpacing && "mb-2",
        config.frame,
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="flex h-5 shrink-0 items-center justify-center">{config.icon}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 select-text">
          {parsed.title ? (
            <span
              className="text-sm leading-5 font-medium text-foreground"
              data-testid="notification-title"
            >
              {parsed.title}
            </span>
          ) : null}
          {bodyText ? (
            <span
              className={cn(
                "whitespace-pre-wrap",
                parsed.title
                  ? "text-xs leading-[18px] text-muted-foreground"
                  : "text-sm leading-5 text-foreground",
              )}
              data-testid="notification-body"
            >
              {bodyText}
            </span>
          ) : null}
        </div>
      </div>
    </div>
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
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="h-px flex-1 bg-border" />
      <div className="flex items-center gap-2 text-[#a1a1aa]">
        {status === "loading" ? <Spinner className="size-5" /> : <Scissors size={12} />}
        <span className="text-[13px] text-muted-foreground">{label}</span>
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
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

/** The running shimmer: a bright peak swept across the label and summary as one track. */
function ShimmerOverlay({
  label,
  secondaryLabel,
  showOpenFileButton,
}: {
  label: string;
  secondaryLabel?: string;
  showOpenFileButton: boolean;
}) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;
    const update = () => setWidth(node.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const duration = Math.max(
    1,
    Math.min(2.3, 1.25 + (label.trim().length + (secondaryLabel?.trim().length ?? 0)) * 0.008),
  );
  const peak = Math.max(42, Math.min(120, Math.max(1, width) * 0.22));
  const style = useMemo(
    () =>
      ({
        "--byspace-shimmer-start": `${-peak}px`,
        "--byspace-shimmer-end": `${width}px`,
        backgroundSize: `${peak}px 100%`,
        animationDuration: `${duration}s`,
      }) as CSSProperties,
    [duration, peak, width],
  );
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center overflow-hidden"
    >
      <span ref={textRef} className="tool-call-shimmer flex min-w-0 items-center" style={style}>
        <span className="shrink-0 text-sm font-medium">{label}</span>
        {secondaryLabel ? (
          <span className="ml-2 min-w-0 shrink truncate text-sm">{secondaryLabel}</span>
        ) : null}
      </span>
      {showOpenFileButton ? <span className="ml-1 size-[22px] shrink-0" /> : null}
    </span>
  );
}

const CHEVRON_STYLE = { transform: "scale(1.3)" };
const CHEVRON_EXPANDED_STYLE = { transform: "scale(1.3) rotate(90deg)" };

/** The badge's leading glyph: a chevron while hovered or open, a warning on error, else the tool icon. */
function BadgeIcon({
  icon: Icon,
  chevron,
  isExpanded,
  isError,
  isActive,
}: {
  icon?: ComponentType<{ size?: number; color?: string }>;
  chevron: boolean;
  isExpanded: boolean;
  isError: boolean;
  isActive: boolean;
}) {
  if (chevron) {
    return (
      <span
        className="-ml-1 flex shrink-0 text-foreground transition-transform"
        style={isExpanded ? CHEVRON_EXPANDED_STYLE : CHEVRON_STYLE}
      >
        <ChevronRight size={12} />
      </span>
    );
  }
  if (isError) return <TriangleAlert size={12} className="-ml-px text-destructive opacity-80" />;
  if (!Icon) return null;
  return (
    <span className={cn("-ml-px flex", isActive ? "text-foreground" : "text-muted-foreground")}>
      <Icon size={12} color="currentColor" />
    </span>
  );
}

/** The badge's label, summary, open-file button and running shimmer. */
function BadgeLabel({
  label,
  secondaryLabel,
  isActive,
  isLoading,
  onOpenFile,
}: {
  label: string;
  secondaryLabel?: string;
  isActive: boolean;
  isLoading: boolean;
  /** Set while the row is hovered and the tool call has a file to open. */
  onOpenFile?: () => void;
}) {
  const { t } = useTranslation();
  const handleOpenFile = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      onOpenFile?.();
    },
    [onOpenFile],
  );
  return (
    <span className="relative flex min-w-0 flex-1 items-center overflow-hidden">
      <span
        className={cn(
          "shrink-0 text-sm font-medium text-foreground",
          isLoading && "opacity-[0.72]",
        )}
      >
        {label}
      </span>
      {secondaryLabel ? (
        <span
          className={cn(
            "ml-2 min-w-0 shrink truncate text-sm",
            isActive ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {secondaryLabel}
        </span>
      ) : null}
      {onOpenFile ? (
        <button
          type="button"
          onClick={handleOpenFile}
          aria-label={t("message.actions.openFile")}
          data-testid="tool-call-open-file"
          className="ml-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <FileSymlink size={14} />
        </button>
      ) : null}
      {isLoading ? (
        <ShimmerOverlay
          label={label}
          secondaryLabel={secondaryLabel}
          showOpenFileButton={Boolean(onOpenFile)}
        />
      ) : null}
    </span>
  );
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
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const isInteractive = Boolean(onToggle);
  const detailContent = renderDetails && isExpanded ? renderDetails() : null;
  const detailWrapperRef = useRef<HTMLDivElement | null>(null);
  const isActive = isHovered || isExpanded;

  useEffect(() => {
    const node = detailWrapperRef.current;
    if (!node || !detailContent) return;
    const stopWheelPropagation = (event: WheelEvent) => {
      if (shouldStopDetailWheelPropagation(node, event)) event.stopPropagation();
    };
    node.addEventListener("wheel", stopWheelPropagation, { passive: true });
    return () => node.removeEventListener("wheel", stopWheelPropagation);
  }, [detailContent]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onToggle || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onToggle();
    },
    [onToggle],
  );
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
    setIsPressed(false);
  }, []);
  const handlePointerDown = useCallback(() => setIsPressed(true), []);
  const handlePointerUp = useCallback(() => setIsPressed(false), []);
  const handleDetailPointerEnter = useCallback(
    () => onDetailHoverChange?.(true),
    [onDetailHoverChange],
  );
  const handleDetailPointerLeave = useCallback(
    () => onDetailHoverChange?.(false),
    [onDetailHoverChange],
  );
  const showOpenFileButton = Boolean(onOpenFile && isHovered);

  return (
    <div
      data-testid={testID}
      className={cn(
        "-mx-[13px]",
        !resolvedDisableOuterSpacing && (isLastInSequence ? "mb-4" : "mb-1"),
        className,
      )}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-expanded={isInteractive ? isExpanded : undefined}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={cn(
          "overflow-hidden rounded-md border border-transparent px-2 py-1",
          isInteractive && cn("cursor-pointer", isActive && "bg-muted", isPressed && "opacity-90"),
        )}
      >
        <div className="flex items-center">
          <span className="mr-1 flex size-[22px] shrink-0 items-center justify-center rounded-full">
            <BadgeIcon
              icon={Icon}
              chevron={isInteractive && isActive}
              isExpanded={isExpanded}
              isError={isError}
              isActive={isActive}
            />
          </span>
          <BadgeLabel
            label={label}
            secondaryLabel={secondaryLabel}
            isActive={isActive}
            isLoading={isLoading}
            onOpenFile={showOpenFileButton ? onOpenFile : undefined}
          />
        </div>
      </div>
      {detailContent ? (
        <div
          ref={detailWrapperRef}
          onPointerEnter={handleDetailPointerEnter}
          onPointerLeave={handleDetailPointerLeave}
          className="ml-[19px] min-w-0 shrink cursor-auto overflow-hidden border-l pt-1 pb-2 pl-3 select-text"
        >
          {detailContent}
        </div>
      ) : null}
    </div>
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
