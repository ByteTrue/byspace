// Override of packages/app/src/panels/new-tab-panel.tsx: the launcher a new tab opens on, with the
// same keyboard model (arrows move between rows, Enter opens, workspace shortcuts pick a row) and
// the same 380px column of 44px rows.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactElement,
} from "react";
import { Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { Shortcut } from "@/components/ui/shortcut";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelIconProps } from "@/panels/panel-registry";
import {
  useWorkspaceTabLaunchCatalog,
  type WorkspaceTabLaunchItem,
} from "@/workspace-tabs/launcher";

const LAUNCHER_ICON_SIZE = 16;
const ROW_SELECTOR = '[data-new-tab-launcher-row="true"]';

function LauncherShortcut({ actionId }: { actionId: string }): ReactElement | null {
  const keys = useShortcutKeys(actionId);
  return keys ? <Shortcut chord={keys} /> : null;
}

function LauncherRow({ item }: { item: WorkspaceTabLaunchItem }) {
  const { tabId } = usePaneContext();
  const handlePress = useCallback(() => item.launch({ kind: "replace", tabId }), [item, tabId]);
  const Icon = item.Icon as ComponentType<PanelIconProps> | undefined;
  return (
    <button
      type="button"
      aria-label={item.label}
      data-new-tab-launcher-row="true"
      disabled={item.disabled}
      onClick={handlePress}
      tabIndex={-1}
      data-testid={`workspace-new-tab-${item.id}`}
      className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-transparent bg-card px-3 text-left outline-none hover:bg-accent focus-visible:border-border focus-visible:bg-accent active:opacity-85 disabled:opacity-50"
    >
      {Icon ? (
        <span className="flex text-muted-foreground">
          <Icon size={LAUNCHER_ICON_SIZE} color="currentColor" />
        </span>
      ) : null}
      {item.terminalIconKey ? (
        <TerminalProfileIcon iconKey={item.terminalIconKey} size={LAUNCHER_ICON_SIZE} />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.label}</span>
      {item.shortcutActionId ? <LauncherShortcut actionId={item.shortcutActionId} /> : null}
    </button>
  );
}

function useNewTabDescriptor() {
  const { t } = useTranslation();
  const label = t("workspace.tabs.actions.newTab");
  return {
    label,
    subtitle: label,
    tooltip: label,
    titleState: "ready" as const,
    icon: Plus,
    statusBucket: null,
  };
}

const NewTabPanel = memo(function NewTabPanel(): ReactElement {
  const { host, serverId, tabId } = usePaneContext();
  const { isInteractive, focusPane } = usePaneFocus();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const groups = useWorkspaceTabLaunchCatalog({
    serverId,
    purpose: host === "explorer" ? "supporting" : "primary",
    host,
  });
  const itemsById = useMemo(
    () => new Map(groups.flatMap((group) => group.items).map((item) => [item.id, item])),
    [groups],
  );
  const handlesWorkspaceShortcuts = isInteractive && host === "main";

  useEffect(() => {
    const container = containerRef.current;
    if (!isInteractive || !container) return;
    const rows = () => Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
    const focusFirstRow = () => rows()[0]?.focus({ preventScroll: true });
    function handlePointerDown(event: PointerEvent) {
      focusPane();
      if (!(event.target instanceof Element) || !event.target.closest(ROW_SELECTOR)) {
        requestAnimationFrame(focusFirstRow);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      const availableRows = rows();
      const currentIndex = availableRows.findIndex((row) => row === document.activeElement);
      let direction = 0;
      if (event.key === "ArrowDown") direction = 1;
      else if (event.key === "ArrowUp") direction = -1;
      if (direction !== 0 && availableRows.length > 0) {
        event.preventDefault();
        let start = currentIndex;
        if (currentIndex < 0) start = direction > 0 ? -1 : 0;
        availableRows[(start + direction + availableRows.length) % availableRows.length]?.focus();
      }
      if (event.key === "Enter" && currentIndex >= 0) {
        event.preventDefault();
        availableRows[currentIndex]?.click();
      }
    }
    container.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("keydown", handleKeyDown);
    focusFirstRow();
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [focusPane, isInteractive]);

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      const launch = (id: string) => {
        const item = itemsById.get(id);
        if (!item) return false;
        item.launch({ kind: "replace", tabId });
        return true;
      };
      if (action.id === "workspace.agent.new" || action.id === "workspace.tab.target.agent")
        return launch("agent") || true;
      if (action.id === "workspace.terminal.new") return launch("terminal") || true;
      if (action.id === "workspace.tab.target.changes")
        return itemsById.has("changes") ? launch("changes") : launch("diff");
      if (action.id === "workspace.tab.target.files") return launch("files");
      return false;
    },
    [itemsById, tabId],
  );
  useKeyboardActionHandler({
    handlerId: `new-tab:${tabId}`,
    actions: [
      "workspace.agent.new",
      "workspace.terminal.new",
      "workspace.tab.target.agent",
      "workspace.tab.target.changes",
      "workspace.tab.target.files",
    ],
    enabled: handlesWorkspaceShortcuts,
    priority: 250,
    handle: handleKeyboardAction,
  });

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="workspace-new-tab-panel"
    >
      <div className="flex grow flex-col items-center justify-center overflow-y-auto p-6">
        <div className="flex w-full max-w-[380px] flex-col gap-12">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              {group.label ? (
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className="text-xs leading-6 text-muted-foreground/70">{group.label}</span>
                  {group.accessory ? (
                    <button
                      type="button"
                      aria-label={group.accessory.label}
                      onClick={group.accessory.run}
                      data-testid="workspace-new-tab-edit-terminal-profiles"
                      className="-m-1 flex size-6 items-center justify-center rounded-md outline-none hover:bg-accent"
                    >
                      <Pencil className="size-3 text-muted-foreground opacity-50" />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {group.items.map((item) => (
                <LauncherRow key={item.id} item={item} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export const newTabPanelRegistration = definePanel("new_tab", {
  component: NewTabPanel,
  useDescriptor: useNewTabDescriptor,
});
