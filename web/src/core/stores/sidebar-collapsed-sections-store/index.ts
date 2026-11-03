import localStorageAsync from "~/lib/local-storage-async";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  type CollapsedProjectsState,
  type PersistedCollapsedProjects,
  mergePersistedCollapsedProjects,
  PersistedCollapsedProjectsSchema,
  serializeCollapsedProjects,
  togglePinnedCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "./state";

interface SidebarCollapsedSectionsState extends CollapsedProjectsState {
  toggleWorkspaceGroupCollapsed: (workspaceGroupKey: string) => void;
  togglePinnedCollapsed: () => void;
}

export const useSidebarCollapsedSectionsStore = create<SidebarCollapsedSectionsState>()(
  persist<SidebarCollapsedSectionsState, [], [], PersistedCollapsedProjects>(
    (set) => ({
      collapsedWorkspaceGroupKeys: new Set(),
      collapsedPinned: false,
      toggleWorkspaceGroupCollapsed: (workspaceGroupKey) =>
        set((state) => toggleWorkspaceGroupCollapsed(state, workspaceGroupKey)),
      togglePinnedCollapsed: () => set((state) => togglePinnedCollapsed(state)),
    }),
    {
      name: "sidebar-collapsed-sections",
      storage: createValidatedPersistStorage(localStorageAsync, PersistedCollapsedProjectsSchema),
      partialize: (state) => serializeCollapsedProjects(state),
      merge: (persistedState, currentState) =>
        mergePersistedCollapsedProjects(persistedState, currentState),
    },
  ),
);
