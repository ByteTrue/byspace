import { describe, expect, it, vi } from "vitest";

import {
  areToolCallPropsEqual,
  isToolCallSubagentEqual,
  resolveJoinedSubagentRow,
  type ToolCallProps,
  type ToolCallSubagentBinding,
} from "./tool-call-subagent-row";

const NO_BINDING = undefined;

function binding(overrides: Partial<ToolCallSubagentBinding> = {}): ToolCallSubagentBinding {
  return {
    status: "running",
    secondaryLabel: "Running tests · 3 turns",
    onOpen: vi.fn(),
    ...overrides,
  };
}

describe("resolveJoinedSubagentRow", () => {
  it("keeps plain tool-call behavior without a binding", () => {
    const handleToggle = vi.fn();
    expect(resolveJoinedSubagentRow(NO_BINDING, "running", true, handleToggle)).toEqual({
      isLoading: true,
      isError: false,
      handlePress: handleToggle,
    });
    expect(resolveJoinedSubagentRow(NO_BINDING, "executing", true, handleToggle)).toEqual({
      isLoading: true,
      isError: false,
      handlePress: handleToggle,
    });
    expect(resolveJoinedSubagentRow(NO_BINDING, "failed", true, handleToggle)).toMatchObject({
      isLoading: false,
      isError: true,
    });
    expect(resolveJoinedSubagentRow(NO_BINDING, "completed", false, handleToggle)).toEqual({
      isLoading: false,
      isError: false,
      handlePress: undefined,
    });
  });

  it("lets a subagent binding own status and press", () => {
    const onOpen = vi.fn();
    const row = resolveJoinedSubagentRow(
      binding({ status: "running", onOpen }),
      "completed",
      true,
      vi.fn(),
    );
    expect(row).toEqual({ isLoading: true, isError: false, handlePress: onOpen });
    expect(
      resolveJoinedSubagentRow(binding({ status: "failed", onOpen }), "completed", true, vi.fn()),
    ).toMatchObject({
      isLoading: false,
      isError: true,
    });
    expect(
      resolveJoinedSubagentRow(binding({ status: "completed", onOpen }), "running", true, vi.fn()),
    ).toMatchObject({
      isLoading: false,
      isError: false,
    });
    // The tool status no longer drives the row while a descriptor is bound.
    expect(
      resolveJoinedSubagentRow(binding({ status: "canceled", onOpen }), "running", true, vi.fn()),
    ).toMatchObject({
      isLoading: false,
      isError: false,
    });
  });
});

describe("isToolCallSubagentEqual", () => {
  const base: { subagent?: ToolCallSubagentBinding } = {};

  it("compares the three binding fields", () => {
    const onOpen = vi.fn();
    const previous = { ...base, subagent: binding({ onOpen }) };
    expect(isToolCallSubagentEqual(previous, { ...base, subagent: binding({ onOpen }) })).toBe(
      true,
    );
    expect(
      isToolCallSubagentEqual(previous, {
        ...base,
        subagent: binding({ onOpen, status: "failed" }),
      }),
    ).toBe(false);
    expect(
      isToolCallSubagentEqual(previous, {
        ...base,
        subagent: binding({ onOpen, secondaryLabel: null }),
      }),
    ).toBe(false);
    expect(
      isToolCallSubagentEqual(previous, { ...base, subagent: binding({ status: "running" }) }),
    ).toBe(false);
  });

  it("treats two missing bindings as equal", () => {
    expect(isToolCallSubagentEqual(base, base)).toBe(true);
  });
});

describe("areToolCallPropsEqual", () => {
  const hoverFn = vi.fn();
  const openFileFn = vi.fn();
  const subagentOnOpen = vi.fn();

  const baseProps: Required<ToolCallProps> = {
    toolName: "bash",
    args: { command: "ls" },
    result: "file.txt",
    error: null,
    status: "completed",
    detail: { type: "unknown", input: null, output: null },
    cwd: "/workspace",
    metadata: { key: "value" },
    isLastInSequence: true,
    disableOuterSpacing: false,
    onInlineDetailsHoverChange: hoverFn,
    onOpenFilePath: openFileFn,
    defaultExpanded: false,
    forceInline: false,
    maxDetailHeight: 300,
    followTail: false,
    summaryOverride: "summary",
    subagent: {
      status: "running",
      secondaryLabel: "subagent label",
      onOpen: subagentOnOpen,
    },
  };

  it("returns true when all props are identical", () => {
    expect(areToolCallPropsEqual(baseProps, { ...baseProps })).toBe(true);
  });

  it("detects changes to each prop in ToolCallProps", () => {
    const mutations: Record<keyof ToolCallProps, unknown> = {
      toolName: "other_tool",
      args: { command: "pwd" },
      result: "other_result",
      error: new Error("err"),
      status: "failed",
      detail: { type: "plain_text", text: "hi" },
      cwd: "/other",
      metadata: { key: "new" },
      isLastInSequence: false,
      disableOuterSpacing: true,
      onInlineDetailsHoverChange: vi.fn(),
      onOpenFilePath: vi.fn(),
      defaultExpanded: true,
      forceInline: true,
      maxDetailHeight: 500,
      followTail: true,
      summaryOverride: "new_summary",
      subagent: {
        status: "completed",
        secondaryLabel: "done",
        onOpen: subagentOnOpen,
      },
    };

    for (const key of Object.keys(mutations) as (keyof ToolCallProps)[]) {
      const nextProps = { ...baseProps, [key]: mutations[key] };
      expect(
        areToolCallPropsEqual(baseProps, nextProps),
        `areToolCallPropsEqual should return false when '${key}' changes`,
      ).toBe(false);
    }
  });
});
