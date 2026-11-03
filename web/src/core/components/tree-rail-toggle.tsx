import { useTranslation } from "react-i18next";
import { FolderTree } from "lucide-react";
import { paneContentToolbarIconSize, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { withTheme } from "~/app/theme-object";

const ThemedFolderTree = withTheme(FolderTree);
/**
 * Opens and closes a `TreeRail`. Every panel that owns a tree rail uses this one
 * button so the affordance reads the same wherever the rail appears; only the
 * flag it drives is per-panel.
 */
export function TreeRailToggle({
  visible,
  testID,
  onToggle,
}: {
  visible: boolean;
  testID: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = t(visible ? "workspace.tree.hideFolderTree" : "workspace.tree.showFolderTree");
  return (
    <ToolbarButton
      label={label}
      selected={visible}
      aria-selected={visible}
      testID={testID}
      onPress={onToggle}
    >
      <ThemedFolderTree
        size={paneContentToolbarIconSize(false)}
        themeProps={extraMutedIconColorMapping}
      />
    </ToolbarButton>
  );
}
