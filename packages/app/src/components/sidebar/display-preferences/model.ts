import { useCallback, useMemo } from "react";
import {
  useAppSettings,
  type SidebarWorkspaceTrailing,
  type WorkspaceTitleSource,
} from "@/hooks/use-settings";
import { useSidebarViewStore, type SidebarLabelFilter } from "@/stores/sidebar-view-store";
import { DEFAULT_SIDEBAR_CHECKS_DISPLAY, type SidebarChecksDisplay } from "./checks-display";
import { DEFAULT_SIDEBAR_ROW_ITEMS, type SidebarRowItem, type SidebarRowItems } from "./row-items";

export type SidebarTrailingChoice = Exclude<SidebarWorkspaceTrailing, "none">;

export interface SidebarDisplayPreferences {
  titleSource: WorkspaceTitleSource;
  setTitleSource: (source: WorkspaceTitleSource) => void;
  rowItems: SidebarRowItems;
  toggleRowItem: (item: SidebarRowItem) => void;
  checksDisplay: SidebarChecksDisplay;
  setChecksDisplay: (display: SidebarChecksDisplay) => void;
  trailing: SidebarWorkspaceTrailing;
  toggleTrailing: (choice: SidebarTrailingChoice) => void;
  hostFilters: readonly string[];
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  projectFilters: readonly string[];
  toggleProjectFilter: (projectKey: string) => void;
  clearProjectFilters: () => void;
  labelFilter: SidebarLabelFilter;
  toggleLabelFilter: (name: string) => void;
  clearLabelFilter: () => void;
}

export function useSidebarDisplayPreferences(): SidebarDisplayPreferences {
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const toggleHostFilter = useSidebarViewStore((state) => state.toggleHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const toggleProjectFilter = useSidebarViewStore((state) => state.toggleProjectFilter);
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const toggleLabelFilter = useSidebarViewStore((state) => state.toggleLabelFilter);
  const clearLabelFilter = useSidebarViewStore((state) => state.clearLabelFilter);
  const {
    settings: {
      workspaceTitleSource,
      sidebarWorkspaceTrailing,
      sidebarRowItems,
      sidebarChecksDisplay,
    },
    updateSettings,
  } = useAppSettings();

  const setTitleSource = useCallback(
    (source: WorkspaceTitleSource) => void updateSettings({ workspaceTitleSource: source }),
    [updateSettings],
  );
  const toggleRowItem = useCallback(
    (item: SidebarRowItem) =>
      void updateSettings({
        sidebarRowItems: { ...sidebarRowItems, [item]: !sidebarRowItems[item] },
      }),
    [sidebarRowItems, updateSettings],
  );
  const setChecksDisplay = useCallback(
    (display: SidebarChecksDisplay) => void updateSettings({ sidebarChecksDisplay: display }),
    [updateSettings],
  );
  const toggleTrailing = useCallback(
    (choice: SidebarTrailingChoice) =>
      void updateSettings({
        sidebarWorkspaceTrailing: sidebarWorkspaceTrailing === choice ? "none" : choice,
      }),
    [sidebarWorkspaceTrailing, updateSettings],
  );

  return useMemo(
    () => ({
      titleSource: workspaceTitleSource,
      setTitleSource,
      rowItems: sidebarRowItems,
      toggleRowItem,
      checksDisplay: sidebarChecksDisplay,
      setChecksDisplay,
      trailing: sidebarWorkspaceTrailing,
      toggleTrailing,
      hostFilters,
      toggleHostFilter,
      clearHostFilters,
      projectFilters,
      toggleProjectFilter,
      clearProjectFilters,
      labelFilter,
      toggleLabelFilter,
      clearLabelFilter,
    }),
    [
      workspaceTitleSource,
      setTitleSource,
      sidebarRowItems,
      toggleRowItem,
      sidebarChecksDisplay,
      setChecksDisplay,
      sidebarWorkspaceTrailing,
      toggleTrailing,
      hostFilters,
      toggleHostFilter,
      clearHostFilters,
      projectFilters,
      toggleProjectFilter,
      clearProjectFilters,
      labelFilter,
      toggleLabelFilter,
      clearLabelFilter,
    ],
  );
}

export function useSidebarMetaPreferences(): {
  rowItems: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
  trailing: SidebarWorkspaceTrailing;
} {
  const { settings } = useAppSettings();
  return useMemo(
    () => ({
      rowItems: settings.sidebarRowItems ?? DEFAULT_SIDEBAR_ROW_ITEMS,
      checksDisplay: settings.sidebarChecksDisplay ?? DEFAULT_SIDEBAR_CHECKS_DISPLAY,
      trailing: settings.sidebarWorkspaceTrailing,
    }),
    [settings.sidebarChecksDisplay, settings.sidebarRowItems, settings.sidebarWorkspaceTrailing],
  );
}
