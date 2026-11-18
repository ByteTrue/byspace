import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  togglePinnedCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedPinned: false,
  };
}

describe("sidebar collapsed sections transitions", () => {
  it("tracks collapsed workspace group keys as a Set", () => {
    let state = emptyState();

    state = toggleWorkspaceGroupCollapsed(state, "running");
    state = toggleWorkspaceGroupCollapsed(state, "done");

    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running", "done"]);
  });

  it("serializes collapsed workspace group keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedPinned: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedPinned: true,
    });
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("rejects the complete value when a persisted workspace group key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedWorkspaceGroupKeys: ["running", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedWorkspaceGroupKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
