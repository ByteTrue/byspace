import { categorizeToolCall } from "@bytetrue/protocol/tool-call-category";
import { describeToolCall, type ToolCallRun } from "../grouping";

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  byspaceCallCount: number;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

/**
 * Counts a run of tool calls for its badge. Categories come from the protocol so the daemon
 * summarizes nested codemode calls through the same rules and a replayed badge cannot drift
 * from the rows it stands for.
 */
export function buildOverviewGroup(run: ToolCallRun): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let byspaceCallCount = 0;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    const match = categorizeToolCall({ name: descriptor.name, detail: descriptor.detail });
    if (match.category === "edited") {
      editedFiles.add(match.filePath);
    } else if (match.category === "read") {
      readFiles.add(match.filePath);
    } else if (match.category === "command") {
      commandCount += 1;
    } else if (match.category === "search") {
      searchCount += 1;
    } else if (match.category === "byspace") {
      byspaceCallCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  const summary = {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    byspaceCallCount,
  };
  return {
    mode: "overview",
    run,
    isLoading,
    summary,
  };
}
