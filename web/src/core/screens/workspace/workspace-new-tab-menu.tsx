// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-new-tab-menu.tsx.
import { Fragment, useCallback, useMemo, type ComponentType, type ReactElement } from "react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "~/components/shortcut";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { PaneHost } from "@/panels/panel-manifest";
import type { PanelIconProps } from "@/panels/panel-registry";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
  type WorkspaceTabLaunchPurpose,
} from "@/workspace-tabs/launcher";

function LaunchItemIcon({ item }: { item: WorkspaceTabLaunchItem }): ReactElement | null {
  if (item.Icon) {
    const Icon = item.Icon as ComponentType<PanelIconProps>;
    return <Icon size={14} color="currentColor" />;
  }
  if (item.terminalIconKey) return <TerminalProfileIcon iconKey={item.terminalIconKey} size={14} />;
  return null;
}

function LaunchItemShortcut({ actionId }: { actionId: string }) {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

function WorkspaceNewTabMenuItem({
  item,
  paneId,
}: {
  item: WorkspaceTabLaunchItem;
  paneId?: string;
}) {
  const handleSelect = useCallback(() => item.launch({ kind: "open", paneId }), [item, paneId]);
  const leading = useMemo(() => <LaunchItemIcon item={item} />, [item]);
  const trailing = useMemo(
    () =>
      item.shortcutActionId ? <LaunchItemShortcut actionId={item.shortcutActionId} /> : undefined,
    [item.shortcutActionId],
  );
  return (
    <DropdownMenuItem
      testID={`workspace-new-tab-menu-${item.id}`}
      leading={leading}
      trailing={trailing}
      disabled={item.disabled}
      onSelect={handleSelect}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

export function WorkspaceNewTabMenuContent({
  serverId,
  purpose,
  host,
  paneId,
}: {
  serverId: string;
  purpose: WorkspaceTabLaunchPurpose;
  host: PaneHost;
  paneId?: string;
}) {
  const groups = useWorkspaceTabLaunchCatalog({ serverId, purpose, host });
  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      offset={4}
      minWidth={200}
      testID="workspace-new-tab-menu"
    >
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
          {group.items.map((item) => (
            <WorkspaceNewTabMenuItem key={item.id} item={item} paneId={paneId} />
          ))}
          {group.accessory ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID={`workspace-new-tab-menu-${group.accessory.id}`}
                onSelect={group.accessory.run}
              >
                {group.accessory.label}
              </DropdownMenuItem>
            </>
          ) : null}
        </Fragment>
      ))}
    </DropdownMenuContent>
  );
}
