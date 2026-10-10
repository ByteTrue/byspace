import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ChiefState {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export const useChiefStore = create<ChiefState>()(
  persist(
    (set) => ({
      isOpen: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
    }),
    {
      name: "byspace.chief",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
