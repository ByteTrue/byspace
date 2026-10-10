import { describe, expect, test } from "vitest";
import type { ToolCallDetail } from "./agent-types.js";
import { categorizeToolCall, type ToolCallCategory } from "./tool-call-category.js";

function detailOf(
  category: ToolCallCategory,
  overrides: Partial<ToolCallDetail> = {},
): ToolCallDetail {
  if (category === "edited") {
    return { type: "write", filePath: "src/a.ts", ...overrides } as ToolCallDetail;
  }
  if (category === "read") {
    return { type: "read", filePath: "src/a.ts", ...overrides } as ToolCallDetail;
  }
  if (category === "command") {
    return { type: "shell", command: "ls", ...overrides } as ToolCallDetail;
  }
  if (category === "search") {
    return { type: "search", query: "*.ts", ...overrides } as ToolCallDetail;
  }
  return { type: "unknown", input: null, output: null } as ToolCallDetail;
}

function categorize(name: string, detail: ToolCallDetail) {
  return categorizeToolCall({ name, detail });
}

describe("categorizeToolCall", () => {
  test("counts a search detail as a search", () => {
    expect(categorize("find", detailOf("search"))).toEqual({ category: "search" });
    // The pi mapper turns `ls` into a search detail, so the live rows and the replay summary agree.
    expect(categorize("ls", detailOf("search"))).toEqual({ category: "search" });
  });

  test("counts a command detail as a command", () => {
    expect(categorize("bash", detailOf("command"))).toEqual({ category: "command" });
  });

  test("returns the path for edits and reads so callers can dedupe", () => {
    expect(categorize("edit", { type: "edit", filePath: "src/a.ts" })).toEqual({
      category: "edited",
      filePath: "src/a.ts",
    });
    expect(categorize("write", { type: "write", filePath: "src/b.ts" })).toEqual({
      category: "edited",
      filePath: "src/b.ts",
    });
    expect(categorize("read", { type: "read", filePath: "src/c.ts" })).toEqual({
      category: "read",
      filePath: "src/c.ts",
    });
  });

  test("matches bysapce tools by name and by prefix", () => {
    expect(categorize("byspace_agent_list", detailOf("other"))).toEqual({ category: "byspace" });
    expect(categorize("mcp__byspace_agent_list__run", detailOf("other"))).toEqual({
      category: "byspace",
    });
  });

  test("matches direct web search tools by suffix even when the detail is unknown", () => {
    expect(categorize("web_search", detailOf("other"))).toEqual({ category: "search" });
    expect(categorize("some__llm_context", detailOf("other"))).toEqual({ category: "search" });
  });

  test("falls back to other", () => {
    expect(categorize("mystery", detailOf("other"))).toEqual({ category: "other" });
    expect(categorize("task", { type: "sub_agent", log: "" })).toEqual({ category: "other" });
  });
});
