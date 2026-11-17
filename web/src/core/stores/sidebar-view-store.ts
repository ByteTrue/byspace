import localStorageAsync from "~/lib/local-storage-async";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { workspaceLabelKey } from "@bytetrue/protocol/workspace-labels";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type SidebarGroupMode = "project" | "status";

const SIDEBAR_VIEW_STORAGE_KEY = "sidebar-view";
const SIDEBAR_VIEW_STORE_VERSION = 7;

/**
 * The key standing for "this workspace carries no labels at all".
 *
 * `normalizeWorkspaceLabelName` trims, so no real label can ever normalize to the empty string
 * and nothing in `labels` can collide with it. That is the whole reason the empty string is the
 * choice: a sentinel like `"__unlabelled__"` would be a name a person is free to type.
 */
export const SIDEBAR_UNLABELLED_LABEL_KEY = "";

/**
 * What the sidebar's Labels page currently says.
 *
 * The labels pinned to, keyed by `workspaceLabelKey`, exactly as `hostFilters` holds server ids:
 * empty means "every label", non-empty includes workspaces carrying any selected label.
 */
export interface SidebarLabelFilter {
  labels: string[];
}

export function hasActiveSidebarLabelFilter(filter: SidebarLabelFilter): boolean {
  return filter.labels.length > 0;
}

/**
 * Include/exclude toggle over an allowlist, shared by the host and project filters.
 *
 * Both filters answer the same question — "is this one of the things I pinned the sidebar to" —
 * so they share the operation. The label filter does not: its keys go through
 * `workspaceLabelKey` first, which is a different identity.
 */
function toggleFilterEntry(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

interface SidebarViewStoreState {
  groupMode: SidebarGroupMode;
  // Empty means "all hosts". A non-empty list pins the sidebar to those hosts.
  hostFilters: string[];
  /**
   * Empty means "all projects". A non-empty list is an allowlist over
   * `SidebarProjectEntry.viewKey` — the same key the project sections are built from.
   *
   * There is deliberately no `reconcileProjectFilters` counterpart to `reconcileHostFilters`.
   * The project list is narrowed by the host filter and is empty before any host connects, so
   * reconciling against it would silently destroy the filter on every cold start and every
   * host-filter change. Stale keys are resolved away at read time instead — see
   * `resolveActiveProjectFilters`.
   */
  projectFilters: string[];
  labelFilter: SidebarLabelFilter;
  setGroupMode: (mode: SidebarGroupMode) => void;
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  toggleProjectFilter: (viewKey: string) => void;
  clearProjectFilters: () => void;
  toggleLabelFilter: (name: string) => void;
  clearLabelFilter: () => void;
  reconcileLabelFilter: (labels: readonly string[]) => void;
  reconcileHostFilters: (serverIds: readonly string[]) => void;
}

interface SidebarViewPersistedState {
  groupMode: SidebarGroupMode;
  hostFilters: string[];
  projectFilters: string[];
  labelFilter: SidebarLabelFilter;
}

const SidebarLabelFilterSchema = z.object({
  labels: z.array(z.string()),
});
const SidebarViewPersistedStateSchema = z.strictObject({
  groupMode: z.enum(["project", "status"]).optional(),
  hostFilters: z.array(z.string()).optional(),
  projectFilters: z.array(z.string()).optional(),
  labelFilter: SidebarLabelFilterSchema.optional(),
});

export function migrateSidebarViewState(persistedState: unknown): SidebarViewPersistedState {
  const result = SidebarViewPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return {
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilter: emptyLabelFilter(),
    };
  }
  const state = result.data;
  return {
    groupMode: state.groupMode === "status" ? "status" : "project",
    hostFilters: state.hostFilters ?? [],
    projectFilters: state.projectFilters ?? [],
    labelFilter: state.labelFilter
      ? normalizeSidebarLabelFilter(state.labelFilter)
      : emptyLabelFilter(),
  };
}

/**
 * Re-keys a persisted filter through `workspaceLabelKey` so the normalized-identity invariant
 * holds even if a stored label was written before trimming was applied.
 */
function normalizeSidebarLabelFilter(filter: SidebarLabelFilter): SidebarLabelFilter {
  const labels = new Set(filter.labels.map(workspaceLabelKey));
  return { labels: [...labels] };
}

export const useSidebarViewStore = create<SidebarViewStoreState>()(
  persist(
    (set) => ({
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilter: emptyLabelFilter(),
      setGroupMode: (mode) => set({ groupMode: mode }),
      toggleHostFilter: (serverId) =>
        set((state) => ({ hostFilters: toggleFilterEntry(state.hostFilters, serverId) })),
      clearHostFilters: () => set({ hostFilters: [] }),
      toggleProjectFilter: (viewKey) =>
        set((state) => ({ projectFilters: toggleFilterEntry(state.projectFilters, viewKey) })),
      clearProjectFilters: () => set({ projectFilters: [] }),
      toggleLabelFilter: (name) =>
        set((state) => {
          const key = workspaceLabelKey(name);
          const labels = state.labelFilter.labels.includes(key)
            ? state.labelFilter.labels.filter((label) => label !== key)
            : [...state.labelFilter.labels, key];
          return { labelFilter: { ...state.labelFilter, labels } };
        }),
      clearLabelFilter: () => set({ labelFilter: emptyLabelFilter() }),
      reconcileLabelFilter: (labels) =>
        set((state) => {
          const available = new Set(labels.map(workspaceLabelKey));
          const next = state.labelFilter.labels.filter(
            (label) => label === SIDEBAR_UNLABELLED_LABEL_KEY || available.has(label),
          );
          if (next.length === state.labelFilter.labels.length) return state;
          return { labelFilter: { labels: next } };
        }),
      reconcileHostFilters: (serverIds) =>
        set((state) => {
          if (state.hostFilters.length === 0) {
            return state;
          }
          const allowed = new Set(serverIds);
          const next = state.hostFilters.filter((id) => allowed.has(id));
          if (next.length === state.hostFilters.length) {
            return state;
          }
          return { hostFilters: next };
        }),
    }),
    {
      name: SIDEBAR_VIEW_STORAGE_KEY,
      version: SIDEBAR_VIEW_STORE_VERSION,
      storage: createValidatedPersistStorage(localStorageAsync, SidebarViewPersistedStateSchema),
      partialize: (state) => ({
        groupMode: state.groupMode,
        hostFilters: state.hostFilters,
        projectFilters: state.projectFilters,
        labelFilter: state.labelFilter,
      }),
      migrate: migrateSidebarViewState,
    },
  ),
);

function emptyLabelFilter(): SidebarLabelFilter {
  return { labels: [] };
}
