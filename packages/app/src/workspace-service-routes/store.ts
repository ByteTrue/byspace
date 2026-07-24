import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WorkspaceScriptLinkKind } from "@/utils/workspace-script-links";

interface WorkspaceServiceRoutePreferencesState {
  byServerId: Record<string, WorkspaceScriptLinkKind>;
  setPreferredRoute: (serverId: string, kind: WorkspaceScriptLinkKind) => void;
}

export const useWorkspaceServiceRoutePreferencesStore =
  create<WorkspaceServiceRoutePreferencesState>()(
    persist(
      (set) => ({
        byServerId: {},
        setPreferredRoute: (serverId, kind) =>
          set((state) => ({ byServerId: { ...state.byServerId, [serverId]: kind } })),
      }),
      {
        name: "byspace-workspace-service-route-preferences",
        version: 1,
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({ byServerId: state.byServerId }),
      },
    ),
  );
