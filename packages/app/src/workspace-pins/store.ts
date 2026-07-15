import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isTargetPinned, togglePinnedTarget, type PinnedTabTarget } from "@/workspace-pins/target";

interface PinnedTargetsState {
  pinned: PinnedTabTarget[];
  toggle: (target: PinnedTabTarget) => void;
  isPinned: (target: PinnedTabTarget) => boolean;
}

const DEFAULT_PINNED_TARGETS: PinnedTabTarget[] = [{ kind: "terminal" }];

function applyDefaultPinnedTargets(pinned: unknown[]): PinnedTabTarget[] {
  const next = [...DEFAULT_PINNED_TARGETS];
  for (const target of pinned) {
    if (!target || typeof target !== "object" || !("kind" in target)) continue;
    if (target.kind !== "draft" && target.kind !== "terminal" && target.kind !== "profile")
      continue;
    if (
      target.kind === "profile" &&
      !("profileId" in target && typeof target.profileId === "string")
    )
      continue;
    const supportedTarget = target as PinnedTabTarget;
    if (!isTargetPinned(next, supportedTarget)) {
      next.push(supportedTarget);
    }
  }
  return next;
}

export const usePinnedTargetsStore = create<PinnedTargetsState>()(
  persist(
    (set, get) => ({
      pinned: [],
      toggle: (target) => set((state) => ({ pinned: togglePinnedTarget(state.pinned, target) })),
      isPinned: (target) => isTargetPinned(get().pinned, target),
    }),
    {
      name: "pinned-tab-targets",
      version: 1,
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PinnedTargetsState> | null;
        return {
          ...currentState,
          ...persisted,
          pinned: applyDefaultPinnedTargets(persisted?.pinned ?? []),
        };
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pinned: state.pinned }),
      migrate: (persistedState, version) => {
        if (version === 0) {
          const pinned = (persistedState as { pinned?: PinnedTabTarget[] } | null)?.pinned ?? [];
          return { pinned: applyDefaultPinnedTargets(pinned) };
        }
        return persistedState as PinnedTargetsState;
      },
    },
  ),
);
