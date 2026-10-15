/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRoleControl } from "./role-control";

vi.mock("@/agent-controls/icons", () => ({
  AgentRoleIcon: () => React.createElement("span", { "data-testid": "role-icon" }),
}));

vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    options,
    value,
    onSelect,
    open,
    onOpenChange,
    header,
  }: {
    options: ReadonlyArray<{ id: string; label: string }>;
    value: string;
    onSelect: (id: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    header?: { title: string };
  }) =>
    open
      ? React.createElement(
          "div",
          { "data-testid": "combobox" },
          header ? React.createElement("span", null, header.title) : null,
          options.map((option) =>
            React.createElement(
              "button",
              {
                key: option.id,
                type: "button",
                "data-testid": `option-${option.id}`,
                "data-selected": value === option.id,
                onClick: () => {
                  onSelect(option.id);
                  // The real combobox closes itself after a selection.
                  onOpenChange?.(false);
                },
              },
              option.label,
            ),
          ),
        )
      : null,
}));

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => cleanup());

describe("AgentRoleControl", () => {
  it("offers no-role first, then every role the host advertised", () => {
    const view = render(
      <AgentRoleControl
        roleNames={["chief", "researcher"]}
        selectedRole=""
        onSelectRole={vi.fn()}
      />,
    );

    fireEvent.click(view.getByTestId("agent-role-selector"));

    expect(view.getByTestId("option-").textContent).toBe("No role");
    expect(view.getByTestId("option-chief").textContent).toBe("Chief");
    // A role this app ships no copy for still reads as words, not as a key.
    expect(view.getByTestId("option-researcher").textContent).toBe("Researcher");
  });

  it("reports the pick as the wire value, with the empty string meaning no role", () => {
    const onSelectRole = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <AgentRoleControl
        roleNames={["chief"]}
        selectedRole="chief"
        onSelectRole={onSelectRole}
        onClose={onClose}
      />,
    );

    fireEvent.click(view.getByTestId("agent-role-selector"));
    fireEvent.click(view.getByTestId("option-"));

    expect(onSelectRole).toHaveBeenCalledWith("");
    // Picked and closed: the picker does not stay open behind the chip.
    expect(view.queryByTestId("combobox")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("puts the current role in the accessible name, not only the control's purpose", () => {
    const view = render(
      <AgentRoleControl roleNames={["chief"]} selectedRole="chief" onSelectRole={vi.fn()} />,
    );

    expect(view.getByTestId("agent-role-selector").getAttribute("aria-label")).toBe(
      "Select agent role (Chief)",
    );
  });

  it("says no role in the accessible name when no role is selected", () => {
    const view = render(
      <AgentRoleControl roleNames={["chief"]} selectedRole="" onSelectRole={vi.fn()} />,
    );

    expect(view.getByTestId("agent-role-selector").getAttribute("aria-label")).toBe(
      "Select agent role (No role)",
    );
  });

  it("names a selected role the catalog no longer lists instead of claiming none", () => {
    const view = render(
      <AgentRoleControl roleNames={["chief"]} selectedRole="retired-role" onSelectRole={vi.fn()} />,
    );

    expect(view.getByTestId("agent-role-selector").textContent).toContain("Retired role");
  });
});
