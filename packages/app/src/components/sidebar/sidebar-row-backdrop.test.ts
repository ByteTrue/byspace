import { describe, expect, it } from "vitest";
import { getSidebarRowBackdrop } from "./sidebar-row-backdrop";

describe("getSidebarRowBackdrop", () => {
  it("matches idle, selected, hovered, pressed, and dragged row surfaces", () => {
    expect(getSidebarRowBackdrop({})).toBe("surfaceSidebar");
    expect(getSidebarRowBackdrop({ selected: true })).toBe("surfaceSidebarSelected");
    expect(getSidebarRowBackdrop({ isHovered: true })).toBe("surfaceSidebarHover");
    expect(getSidebarRowBackdrop({ isPressed: true, selected: true })).toBe("surface2");
    expect(getSidebarRowBackdrop({ isDragging: true, isHovered: true })).toBe("surface2");
  });

  it("keeps selected rows on the selected surface while hovered", () => {
    expect(getSidebarRowBackdrop({ selected: true, isHovered: true })).toBe(
      "surfaceSidebarSelected",
    );
  });
});
