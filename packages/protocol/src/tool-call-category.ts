import type { ToolCallDetail } from "./agent-types.js";
import { isBySpaceToolName, normalizeToolName } from "./tool-name-normalization.js";

const DIRECT_BYSPACE_TOOL_PREFIX = "byspace_";
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export type ToolCallCategory = "byspace" | "edited" | "command" | "read" | "search" | "other";

/**
 * The bucket a call is counted in, plus the file it touched for the categories that dedupe by
 * path. The overview badge counts calls this way, live and on replay.
 */
export type ToolCallCategoryMatch =
  | { category: "byspace" | "command" | "search" | "other" }
  | { category: "edited" | "read"; filePath: string };

/**
 * Buckets a tool call for the "ran 1 command, read 2 files" summaries. The daemon summarizes
 * nested calls and the app groups rows with this same function, so a replay badge counts what
 * the live rows counted: `ls` is a search, an unparsable `read` falls into other, and so on.
 */
export function categorizeToolCall(input: {
  name: string;
  detail: ToolCallDetail;
}): ToolCallCategoryMatch {
  const name = normalizeToolName(input.name);
  if (isBySpaceToolName(input.name) || name.startsWith(DIRECT_BYSPACE_TOOL_PREFIX)) {
    return { category: "byspace" };
  }
  const detail = input.detail;
  if (detail.type === "edit" || detail.type === "write") {
    return { category: "edited", filePath: detail.filePath };
  }
  if (detail.type === "read") {
    return { category: "read", filePath: detail.filePath };
  }
  if (detail.type === "shell") {
    return { category: "command" };
  }
  if (detail.type === "search" || DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name)) {
    return { category: "search" };
  }
  return { category: "other" };
}
