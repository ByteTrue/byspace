// @vitest-environment jsdom
import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { handleTrackNavigation } from "./tracks";

function dispatch(target: HTMLElement, currentTarget: HTMLElement, key: string) {
  let prevented = false;
  handleTrackNavigation({
    key,
    target,
    currentTarget,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as KeyboardEvent<HTMLDivElement>);
  return prevented;
}

describe("composer track keyboard navigation", () => {
  it("moves between rows, wraps, and honors Home and End", () => {
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const rows = [0, 1, 2].map(() => {
      const row = document.createElement("div");
      row.tabIndex = -1;
      row.dataset.composerTrackRow = "";
      panel.appendChild(row);
      return row;
    });
    rows[0]!.tabIndex = 0;
    expect(dispatch(rows[0]!, panel, "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    dispatch(rows[1], panel, "End");
    expect(document.activeElement).toBe(rows[2]);
    dispatch(rows[2], panel, "ArrowDown");
    expect(document.activeElement).toBe(rows[0]);
    dispatch(rows[0], panel, "ArrowUp");
    expect(document.activeElement).toBe(rows[2]);
    dispatch(rows[2]!, panel, "Home");
    expect(document.activeElement).toBe(rows[0]);
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves focus away from a disabled row and clears its tab stop", () => {
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const disabled = document.createElement("button");
    const enabled = document.createElement("button");
    disabled.setAttribute("aria-disabled", "true");
    for (const row of [disabled, enabled]) {
      row.dataset.composerTrackRow = "";
      row.tabIndex = 0;
      panel.appendChild(row);
    }
    disabled.focus();
    expect(dispatch(disabled, panel, "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(enabled);
    expect(disabled.tabIndex).toBe(-1);
    expect(enabled.tabIndex).toBe(0);
  });
});
