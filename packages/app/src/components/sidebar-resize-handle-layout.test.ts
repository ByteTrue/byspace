import { describe, expect, it } from "vitest";
import {
  resolveSidebarResizeHandleGeometry,
  resolveSidebarResizeHandleVariant,
  resolveSidebarResizePanGestureConfig,
} from "./sidebar-resize-handle-layout";

describe("resolveSidebarResizeHandleGeometry", () => {
  it("uses the exact upstream 24x88 coarse-browser target inside the sidebar", () => {
    expect(resolveSidebarResizeHandleGeometry(false)).toEqual({
      edgeOffset: 0,
      width: 24,
      height: 88,
    });
  });

  it("uses the exact full-height border target for a fine pointer", () => {
    expect(resolveSidebarResizeHandleGeometry(true)).toEqual({
      edgeOffset: -5,
      width: 10,
      height: null,
    });
  });
});

describe("resolveSidebarResizeHandleVariant", () => {
  it("selects the coarse target only for a coarse Browser pointer", () => {
    expect(resolveSidebarResizeHandleVariant(true, false)).toBe("coarse");
    expect(resolveSidebarResizeHandleVariant(true, true)).toBe("pointer");
    expect(resolveSidebarResizeHandleVariant(false, false)).toBe("pointer");
    expect(resolveSidebarResizeHandleVariant(false, true)).toBe("pointer");
  });
});

describe("resolveSidebarResizePanGestureConfig", () => {
  it("adds scroll arbitration only on Web", () => {
    expect(resolveSidebarResizePanGestureConfig(true)).toEqual({
      activeOffsetX: [-6, 6],
      failOffsetY: [-12, 12],
    });
    expect(resolveSidebarResizePanGestureConfig(false)).toBeNull();
  });
});
