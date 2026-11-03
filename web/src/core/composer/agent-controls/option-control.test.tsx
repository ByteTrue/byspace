/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerOptionControl } from "./option-control";

vi.mock("@/agent-controls/icons", () => ({
  AgentRoleIcon: () => React.createElement("span", { "data-testid": "icon" }),
}));

/**
 * Whether the fake combobox closes itself after a selection, the way the real
 * one does (it runs its own onOpenChange(false) after onSelect). Flipped off in
 * one test to prove the control owns the handshake for comboboxes that do not.
 */
let mockSelfClosesOnSelect = true;

/**
 * A combobox that reports closes the way the real one does: the select path
 * fires onSelect and then its own onOpenChange(false), so the handshake sees the
 * same transition twice.
 */
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    options,
    onSelect,
    open,
    onOpenChange,
  }: {
    options: ReadonlyArray<{ id: string; label: string }>;
    onSelect: (id: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open
      ? React.createElement(
          "div",
          { "data-testid": "combobox" },
          options.map((option) =>
            React.createElement(
              "button",
              {
                key: option.id,
                type: "button",
                "data-testid": `option-${option.id}`,
                onClick: () => {
                  onSelect(option.id);
                  if (mockSelfClosesOnSelect) onOpenChange?.(false);
                },
              },
              option.label,
            ),
          ),
        )
      : null,
}));

const OPTIONS = [
  { id: "", label: "No role" },
  { id: "chief", label: "Chief" },
];

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockSelfClosesOnSelect = true;
});

function renderControl(props: Partial<React.ComponentProps<typeof ComposerOptionControl>> = {}) {
  return render(
    <ComposerOptionControl
      icon={"Bot" as never}
      surface="toolbar"
      label="Select agent role"
      testID="option-control-trigger"
      options={OPTIONS}
      selectedId=""
      onSelect={vi.fn()}
      {...props}
    />,
  );
}

describe("ComposerOptionControl", () => {
  it("self-manages open when the parent does not control it", () => {
    const view = renderControl();

    expect(view.queryByTestId("combobox")).toBeNull();
    fireEvent.click(view.getByTestId("option-control-trigger"));
    expect(view.getByTestId("combobox")).toBeTruthy();
  });

  it("reports one open change per transition when a pick closes the list", () => {
    // The real combobox reports the close itself after onSelect, so a naive
    // handshake calls the parent back twice for one selection. Parents act on it
    // (focus, sheet state), and the second call starts duplicate work.
    const onOpenChange = vi.fn();
    const onClose = vi.fn();
    const view = renderControl({ open: true, onOpenChange, onClose });

    fireEvent.click(view.getByTestId("option-chief"));

    expect(onOpenChange.mock.calls).toEqual([[false]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the open state it is told to hold while controlled", () => {
    const onOpenChange = vi.fn();
    const view = renderControl({ open: false, onOpenChange });

    fireEvent.click(view.getByTestId("option-control-trigger"));

    expect(onOpenChange.mock.calls).toEqual([[true]]);
    // Controlled: the list does not open on its own.
    expect(view.queryByTestId("combobox")).toBeNull();
  });

  it("closes on select even when the combobox does not close itself", () => {
    // The handshake is owned here, not by the combobox: keepOpenOnSelect and
    // other presentations leave the list open and expect the control to close it.
    mockSelfClosesOnSelect = false;
    const onOpenChange = vi.fn();
    const onClose = vi.fn();
    const view = renderControl({ onOpenChange, onClose });

    fireEvent.click(view.getByTestId("option-control-trigger"));
    fireEvent.click(view.getByTestId("option-chief"));

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId("combobox")).toBeNull();
  });

  it("fires onClose only on a close that follows an open", () => {
    const onClose = vi.fn();
    const view = renderControl({ onClose });

    // A close report for a list that was never open is not a transition.
    fireEvent.click(view.getByTestId("option-control-trigger"));
    fireEvent.click(view.getByTestId("option-chief"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
