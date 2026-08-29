import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";

/** Resolve the surface a project-only sidebar row is currently painting. */
export function getSidebarRowBackdrop({
  isDragging = false,
  isPressed = false,
  selected = false,
  isHovered = false,
}: {
  isDragging?: boolean;
  isPressed?: boolean;
  selected?: boolean;
  isHovered?: boolean;
}): SidebarSurfaceBackdrop {
  if (isDragging || isPressed) return "surface2";
  if (selected) return "surfaceSidebarSelected";
  if (isHovered) return "surfaceSidebarHover";
  return "surfaceSidebar";
}
