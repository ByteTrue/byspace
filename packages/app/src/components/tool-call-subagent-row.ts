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
