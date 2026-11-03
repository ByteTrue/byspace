// The PR pane's activity timeline: comments, reviews and review threads, each with its kebab menu
// and "Add to chat". The view half of archive/expo-app:packages/app/src/git/pull-request-panel/pane.tsx (from
// TimelineEntryCard down); the pane (core/git/pull-request-panel/pane.tsx) renders these. Kebabs show on hover, while their menu is open, and always on a phone.
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  CircleCheck,
  CircleX,
  Copy,
  ExternalLink,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatPullRequestThreadPath } from "@/git/pull-request-panel/activity-location";
import { canAddPullRequestActivityToChat } from "@/git/pull-request-panel/context-attachment";
import { getActivityVerb, type PrPaneActivity } from "@/git/pull-request-panel/data";
import type {
  PrReviewEntry,
  PrThreadEntry,
  PrTimelineEntry,
} from "@/git/pull-request-panel/timeline";
import { openExternalUrl } from "@/utils/open-external-url";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { cn } from "cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";

const ADD_TO_CHAT_MENU_ICON = <MessageSquarePlus size={14} className="text-muted-foreground" />;
const COPY_MENU_ICON = <Copy size={14} className="text-muted-foreground" />;
const OPEN_MENU_ICON = <ExternalLink size={14} className="text-muted-foreground" />;
const CARD = "mx-3 mb-3 overflow-hidden rounded-lg border bg-sidebar";
const ROW_HEADER =
  "flex min-h-9 cursor-pointer items-center gap-2 px-3 py-2 hover:bg-sidebar-accent";

function handleMarkdownLinkPress(url: string): boolean {
  void openExternalUrl(url);
  return false;
}

/**
 * A row you can press that holds its own buttons (kebab, "Add to chat"). React Native gave the
 * press to the innermost pressable; here a press that lands on an inner control, or bubbles in
 * from a portalled menu, is not the row's.
 */
function PressableRow({
  onPress,
  className,
  children,
}: {
  onPress: () => void;
  className: string;
  children: ReactNode;
}) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element) || !event.currentTarget.contains(target)) return;
      const control = target.closest("button, a, input, textarea, [role='menuitem']");
      if (control && event.currentTarget.contains(control)) return;
      onPress();
    },
    [onPress],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onPress();
    },
    [onPress],
  );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={className}
    >
      {children}
    </div>
  );
}

interface TimelineEntryCallbacks {
  attachEnabled: boolean;
  brandLabel: string;
  onAddToChat: (activity: PrPaneActivity) => void;
  onAddThreadToChat: (thread: PrThreadEntry) => void;
  onToggleCollapsed: (entryId: string, collapsed: boolean) => void;
}

export function TimelineEntryCard({
  entry,
  collapsed,
  collapsedEntryIds,
  ...callbacks
}: TimelineEntryCallbacks & {
  entry: PrTimelineEntry;
  collapsed: boolean;
  collapsedEntryIds: ReadonlySet<string>;
}) {
  if (entry.kind === "thread") {
    return <ThreadCard entry={entry} collapsed={collapsed} {...callbacks} />;
  }
  if (entry.kind === "review") {
    return (
      <ReviewCard
        entry={entry}
        collapsed={collapsed}
        collapsedEntryIds={collapsedEntryIds}
        {...callbacks}
      />
    );
  }
  return <SingleActivityCard entry={entry} collapsed={collapsed} {...callbacks} />;
}

function useRevealOnHover() {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const actionsVisible = isHovered || menuOpen || isCompact;
  return { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen };
}

function KebabSlot({
  visible,
  label,
  onMenuOpenChange,
  children,
}: {
  visible: boolean;
  label: string;
  onMenuOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex w-[22px] items-center justify-center",
        !visible && "pointer-events-none opacity-0",
      )}
    >
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={label}>
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[200px]"
          onCloseAutoFocus={keepFocusElsewhere}
        >
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function ActivityKebab({
  activity,
  visible,
  attachEnabled,
  brandLabel,
  onMenuOpenChange,
  onAddToChat,
}: {
  activity: PrPaneActivity;
  visible: boolean;
  attachEnabled: boolean;
  brandLabel: string;
  onMenuOpenChange: (open: boolean) => void;
  onAddToChat: (activity: PrPaneActivity) => void;
}) {
  const { t } = useTranslation();
  const handleAddToChat = useCallback(() => onAddToChat(activity), [activity, onAddToChat]);
  const handleCopy = useCallback(() => {
    void writeMarkdownToRichClipboard(activity.body, getDefaultMarkdownClipboardEnvironment());
  }, [activity.body]);
  const handleOpen = useCallback(() => {
    void openExternalUrl(activity.url);
  }, [activity.url]);
  return (
    <KebabSlot visible={visible} label="Comment actions" onMenuOpenChange={onMenuOpenChange}>
      {attachEnabled && canAddPullRequestActivityToChat(activity) ? (
        <DropdownMenuItem onSelect={handleAddToChat}>
          {ADD_TO_CHAT_MENU_ICON}
          Add to chat
        </DropdownMenuItem>
      ) : null}
      {activity.body.trim() !== "" ? (
        <DropdownMenuItem onSelect={handleCopy}>
          {COPY_MENU_ICON}
          Copy
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={handleOpen}>
        {OPEN_MENU_ICON}
        {t("workspace.git.pr.actions.openOn", { brand: brandLabel })}
      </DropdownMenuItem>
    </KebabSlot>
  );
}

function ActivityAvatar({ activity, size }: { activity: PrPaneActivity; size: number }) {
  const frameStyle = useMemo<CSSProperties>(
    () => ({ width: size, height: size, backgroundColor: activity.avatarColor }),
    [activity.avatarColor, size],
  );
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={frameStyle}
    >
      {activity.avatarUrl ? (
        <img src={activity.avatarUrl} alt="" width={size} height={size} className="rounded-full" />
      ) : (
        <span className="text-[10px] text-white">{activity.author.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

function ActivityVerb({ activity }: { activity: PrPaneActivity }) {
  const verb = getActivityVerb(activity).toLowerCase();
  if (activity.kind === "review" && activity.reviewState === "approved") {
    return (
      <span className="flex items-center gap-1 text-status-success">
        <CircleCheck size={12} />
        <span className="text-xs">{verb}</span>
      </span>
    );
  }
  if (activity.kind === "review" && activity.reviewState === "changes_requested") {
    return (
      <span className="flex items-center gap-1 text-status-danger">
        <CircleX size={12} />
        <span className="text-xs">{verb}</span>
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{verb}</span>;
}

function ActivityHeader({
  activity,
  avatarSize,
  children,
}: {
  activity: PrPaneActivity;
  avatarSize: number;
  children?: ReactNode;
}) {
  return (
    <>
      <ActivityAvatar activity={activity} size={avatarSize} />
      <span className="min-w-0 shrink truncate text-sm text-foreground">{activity.author}</span>
      <ActivityVerb activity={activity} />
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">{activity.age}</span>
        {children}
      </span>
    </>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-[3px] text-muted-foreground">
      <MessageSquare size={11} />
      <span className="text-xs">{count}</span>
    </span>
  );
}

function AddToChatFooter({ onPress }: { onPress: () => void }) {
  return (
    <div className="flex pr-2 pb-2">
      <Button variant="ghost" size="xs" onClick={onPress}>
        <MessageSquarePlus data-icon="inline-start" />
        Add to chat
      </Button>
    </div>
  );
}

function SingleActivityCard({
  entry,
  collapsed,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onToggleCollapsed,
}: TimelineEntryCallbacks & {
  entry: Extract<PrTimelineEntry, { kind: "single" }>;
  collapsed: boolean;
}) {
  const { activity } = entry;
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  const hasBody = activity.body.trim() !== "";
  const handleAddToChat = useCallback(() => onAddToChat(activity), [activity, onAddToChat]);
  const handleHeaderPress = useCallback(() => {
    if (hasBody) {
      onToggleCollapsed(entry.id, collapsed);
      return;
    }
    void openExternalUrl(activity.url);
  }, [activity.url, collapsed, entry.id, hasBody, onToggleCollapsed]);
  const header = (
    <PressableRow onPress={handleHeaderPress} className={ROW_HEADER}>
      <ActivityHeader activity={activity} avatarSize={20}>
        <ActivityKebab
          activity={activity}
          visible={actionsVisible}
          attachEnabled={attachEnabled}
          brandLabel={brandLabel}
          onMenuOpenChange={setMenuOpen}
          onAddToChat={onAddToChat}
        />
      </ActivityHeader>
    </PressableRow>
  );

  if (!hasBody) {
    return (
      <div
        className="mx-3 mb-2"
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        data-testid="pr-pane-activity-row"
      >
        {header}
      </div>
    );
  }

  return (
    <div
      className={CARD}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid="pr-pane-activity-row"
    >
      {header}
      {collapsed ? null : (
        <>
          <div className="px-3 pt-2 pb-3">
            <MarkdownRenderer text={activity.body} compact onLinkPress={handleMarkdownLinkPress} />
          </div>
          {attachEnabled && canAddPullRequestActivityToChat(activity) ? (
            <AddToChatFooter onPress={handleAddToChat} />
          ) : null}
        </>
      )}
    </div>
  );
}

function ThreadCard({
  entry,
  collapsed,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onAddThreadToChat,
  onToggleCollapsed,
}: TimelineEntryCallbacks & {
  entry: PrThreadEntry;
  collapsed: boolean;
}) {
  return (
    <div className={CARD} data-testid="pr-pane-activity-row">
      <ThreadBlock
        thread={entry}
        collapsed={collapsed}
        attachEnabled={attachEnabled}
        brandLabel={brandLabel}
        onAddToChat={onAddToChat}
        onAddThreadToChat={onAddThreadToChat}
        onToggleCollapsed={onToggleCollapsed}
      />
    </div>
  );
}

function ReviewCard({
  entry,
  collapsed,
  collapsedEntryIds,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onAddThreadToChat,
  onToggleCollapsed,
}: TimelineEntryCallbacks & {
  entry: PrReviewEntry;
  collapsed: boolean;
  collapsedEntryIds: ReadonlySet<string>;
}) {
  const { review, threads } = entry;
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  const hasBody = review.body.trim() !== "";
  const canAddToChat = attachEnabled && canAddPullRequestActivityToChat(review);
  const handleAddToChat = useCallback(() => onAddToChat(review), [onAddToChat, review]);
  const handleHeaderPress = useCallback(() => {
    onToggleCollapsed(entry.id, collapsed);
  }, [collapsed, entry.id, onToggleCollapsed]);

  return (
    <div
      className={CARD}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid="pr-pane-activity-row"
    >
      <PressableRow onPress={handleHeaderPress} className={ROW_HEADER}>
        <ActivityHeader activity={review} avatarSize={20}>
          {collapsed && canAddToChat ? (
            <Button variant="ghost" size="xs" onClick={handleAddToChat} className="py-0">
              <MessageSquarePlus data-icon="inline-start" />
              Add to chat
            </Button>
          ) : null}
          {collapsed ? <CountBadge count={threads.length} /> : null}
          <ActivityKebab
            activity={review}
            visible={actionsVisible}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onMenuOpenChange={setMenuOpen}
            onAddToChat={onAddToChat}
          />
        </ActivityHeader>
      </PressableRow>
      {collapsed ? null : (
        <>
          {hasBody ? (
            <div className="px-3 pt-2 pb-3">
              <MarkdownRenderer text={review.body} compact onLinkPress={handleMarkdownLinkPress} />
            </div>
          ) : null}
          {canAddToChat ? <AddToChatFooter onPress={handleAddToChat} /> : null}
          {threads.length > 0 ? (
            <div className="py-1">
              {threads.map((thread) => (
                <div key={thread.id} className="mx-3 mb-2 overflow-hidden rounded-md border">
                  <ThreadBlock
                    thread={thread}
                    collapsed={collapsedEntryIds.has(thread.id)}
                    attachEnabled={attachEnabled}
                    brandLabel={brandLabel}
                    onAddToChat={onAddToChat}
                    onAddThreadToChat={onAddThreadToChat}
                    onToggleCollapsed={onToggleCollapsed}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ThreadBlock({
  thread,
  collapsed,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onAddThreadToChat,
  onToggleCollapsed,
}: {
  thread: PrThreadEntry;
  collapsed: boolean;
  attachEnabled: boolean;
  brandLabel: string;
  onAddToChat: (activity: PrPaneActivity) => void;
  onAddThreadToChat: (thread: PrThreadEntry) => void;
  onToggleCollapsed: (entryId: string, collapsed: boolean) => void;
}) {
  const { t } = useTranslation();
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  const handleHeaderPress = useCallback(() => {
    onToggleCollapsed(thread.id, collapsed);
  }, [collapsed, onToggleCollapsed, thread.id]);
  const handleAddThreadToChat = useCallback(
    () => onAddThreadToChat(thread),
    [onAddThreadToChat, thread],
  );
  const handleOpenThread = useCallback(() => {
    void openExternalUrl(thread.comments[0].url);
  }, [thread.comments]);

  const [root, ...replies] = thread.comments;

  return (
    <div onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <PressableRow onPress={handleHeaderPress} className={cn(ROW_HEADER, "bg-card")}>
        <span className="min-w-0 shrink truncate font-mono text-xs text-foreground">
          {thread.location
            ? formatPullRequestThreadPath(thread.location)
            : t("workspace.git.pr.thread.discussion")}
        </span>
        {thread.isResolved ? (
          <Badge variant="secondary" className="text-status-success">
            Resolved
          </Badge>
        ) : null}
        {thread.location?.isOutdated ? <Badge variant="secondary">Outdated</Badge> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {collapsed ? <CountBadge count={thread.comments.length} /> : null}
          <KebabSlot visible={actionsVisible} label="Thread actions" onMenuOpenChange={setMenuOpen}>
            <DropdownMenuItem onSelect={handleOpenThread}>
              {OPEN_MENU_ICON}
              {t("workspace.git.pr.actions.openOn", { brand: brandLabel })}
            </DropdownMenuItem>
          </KebabSlot>
        </span>
      </PressableRow>
      {collapsed ? null : (
        <>
          <ThreadComment
            comment={root}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onAddToChat={onAddToChat}
          />
          {replies.length > 0 ? (
            <div className="mx-3 mt-2">
              {replies.map((reply) => (
                <div key={reply.id} className="mb-2 overflow-hidden rounded-md border bg-card">
                  <ThreadComment
                    comment={reply}
                    attachEnabled={attachEnabled}
                    brandLabel={brandLabel}
                    onAddToChat={onAddToChat}
                    isReply
                  />
                </div>
              ))}
            </div>
          ) : null}
          {attachEnabled ? <AddToChatFooter onPress={handleAddThreadToChat} /> : null}
        </>
      )}
    </div>
  );
}

function ThreadComment({
  comment,
  attachEnabled,
  brandLabel,
  onAddToChat,
  isReply = false,
}: {
  comment: PrPaneActivity;
  attachEnabled: boolean;
  brandLabel: string;
  onAddToChat: (activity: PrPaneActivity) => void;
  isReply?: boolean;
}) {
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  return (
    <div
      className={cn("pb-2", !isReply && "border-t")}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div className="flex min-h-8 items-center gap-2 px-3 pt-2 pb-1">
        <ActivityHeader activity={comment} avatarSize={16}>
          <ActivityKebab
            activity={comment}
            visible={actionsVisible}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onMenuOpenChange={setMenuOpen}
            onAddToChat={onAddToChat}
          />
        </ActivityHeader>
      </div>
      {comment.body.trim() !== "" ? (
        <div className="px-3 pt-2">
          <MarkdownRenderer text={comment.body} compact onLinkPress={handleMarkdownLinkPress} />
        </div>
      ) : null}
    </div>
  );
}
