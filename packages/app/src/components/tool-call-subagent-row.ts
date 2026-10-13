import type { ToolCallDetail } from "@bytetrue/protocol/agent-types";

// A subagent descriptor bound to a tool-call row: status drives the row state, secondaryLabel
// replaces the summary, and onOpen opens the read-only subagent tab.
export interface ToolCallSubagentBinding {
  status: "running" | "completed" | "failed" | "canceled";
  secondaryLabel: string | null;
  onOpen: () => void;
}

/** Tool-call statuses a joined subagent row can override. */
type JoinedToolCallStatus = "executing" | "running" | "completed" | "failed" | "canceled";

// A joined subagent descriptor owns the row: its status replaces the tool status and the whole
// badge opens the subagent tab. Without a binding the row behaves like a plain tool call.
export function resolveJoinedSubagentRow(
  subagent: ToolCallSubagentBinding | undefined,
  status: JoinedToolCallStatus,
  canOpenDetails: boolean,
  handleToggle: () => void,
): {
  isLoading: boolean;
  isError: boolean;
  handlePress: (() => void) | undefined;
} {
  if (!subagent) {
    return {
      isLoading: status === "running" || status === "executing",
      isError: status === "failed",
      handlePress: canOpenDetails ? handleToggle : undefined,
    };
  }
  return {
    isLoading: subagent.status === "running",
    isError: subagent.status === "failed",
    handlePress: subagent.onOpen,
  };
}

export function isToolCallSubagentEqual(
  previous: { subagent?: ToolCallSubagentBinding },
  next: { subagent?: ToolCallSubagentBinding },
) {
  return (
    previous.subagent?.status === next.subagent?.status &&
    previous.subagent?.secondaryLabel === next.subagent?.secondaryLabel &&
    previous.subagent?.onOpen === next.subagent?.onOpen
  );
}

// 新增 prop 必须同步加进 areToolCallPropsEqual 比较器与 message.tool-call-subagent.test.tsx
export interface ToolCallProps {
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  onInlineDetailsHoverChange?: (hovered: boolean) => void;
  onOpenFilePath?: (filePath: string) => void;
  defaultExpanded?: boolean;
  forceInline?: boolean;
  maxDetailHeight?: number;
  /** Streaming content (thinking) keeps its detail scroll pinned to the newest lines. */
  followTail?: boolean;
  /** Replaces the badge's secondary text; nested codemode rows summarize the calls the script ran. */
  summaryOverride?: string;
  subagent?: ToolCallSubagentBinding;
}

export function areToolCallPropsEqual(previous: ToolCallProps, next: ToolCallProps) {
  if (previous.toolName !== next.toolName) return false;
  if (previous.args !== next.args) return false;
  if (previous.result !== next.result) return false;
  if (previous.error !== next.error) return false;
  if (previous.status !== next.status) return false;
  if (previous.detail !== next.detail) return false;
  if (previous.cwd !== next.cwd) return false;
  if (previous.metadata !== next.metadata) return false;
  if (previous.summaryOverride !== next.summaryOverride) return false;
  if (!isToolCallSubagentEqual(previous, next)) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.onInlineDetailsHoverChange !== next.onInlineDetailsHoverChange) return false;
  if (previous.onOpenFilePath !== next.onOpenFilePath) return false;
  if (previous.defaultExpanded !== next.defaultExpanded) return false;
  if (previous.forceInline !== next.forceInline) return false;
  if (previous.maxDetailHeight !== next.maxDetailHeight) return false;
  if (previous.followTail !== next.followTail) return false;
  return true;
}
