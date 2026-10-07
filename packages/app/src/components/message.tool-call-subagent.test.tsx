import { describe, expect, it, vi } from "vitest";

import {
  isToolCallSubagentEqual,
  resolveJoinedSubagentRow,
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
