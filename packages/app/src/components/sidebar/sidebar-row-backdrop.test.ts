import { describe, expect, it } from "vitest";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";

describe("getSidebarRowBackdrop", () => {
  it("keeps selected rows on the selected surface while hovered", () => {
    expect(getSidebarRowBackdrop({ selected: true, isHovered: true })).toBe(
      "surfaceSidebarSelected",
    );
  });

  it("uses the hover surface for an unselected hovered row", () => {
    expect(getSidebarRowBackdrop({ isHovered: true })).toBe("surfaceSidebarHover");
  });

  it("moves an unselected pressed row past hover, where Light keeps hover and surface2 equal", () => {
    expect(getSidebarRowBackdrop({ isPressed: true })).toBe("surfaceSidebarSelected");
  });

  it("lets pressed win over dragging, matching the row style array order", () => {
    expect(getSidebarRowBackdrop({ isDragging: true, isPressed: true })).toBe(
      "surfaceSidebarSelected",
    );
  });
});
