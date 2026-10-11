import { create } from "zustand";

interface ChiefState {
  isOpen: boolean;
  /** Bumped by the retry button so the resolve effect in useChiefAgent re-runs. */
  retryCount: number;
  toggle: () => void;
  open: () => void;
  close: () => void;
  requestRetry: () => void;
}

export const useChiefStore = create<ChiefState>()((set) => ({
  isOpen: false,
  retryCount: 0,
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  requestRetry: () => set((state) => ({ retryCount: state.retryCount + 1 })),
}));
