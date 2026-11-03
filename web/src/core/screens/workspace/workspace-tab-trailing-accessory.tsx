// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-tab-trailing-accessory.tsx: the "..."
// beside each row of the phone tab switcher, holding that tab's menu.
import { useMemo, type ReactElement, type SyntheticEvent } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Copy,
  CopyX,
  Ellipsis,
  Pencil,
  RotateCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { keepFocusElsewhere } from "~/lib/menu-focus";
import { WithTooltip } from "~/components/with-tooltip";

const MENU_ICONS = {
  copy: Copy,
  "rotate-cw": RotateCw,
  "arrow-left-to-line": ArrowLeftToLine,
  "arrow-right-to-line": ArrowRightToLine,
  "copy-x": CopyX,
  pencil: Pencil,
  x: X,
} as const;

function MobileTabDropdownMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const Icon = entry.icon ? MENU_ICONS[entry.icon as keyof typeof MENU_ICONS] : undefined;
  const leading = useMemo(() => (Icon ? <Icon /> : undefined), [Icon]);
  const trailing = useMemo(
    () => (entry.hint ? <span>{entry.hint}</span> : undefined),
    [entry.hint],
  );
  return (
    <WithTooltip tooltip={entry.tooltip}>
      <DropdownMenuItem
        data-testid={entry.testID}
        disabled={entry.disabled}
        variant={entry.destructive ? "destructive" : "default"}
        onSelect={entry.onSelect}
      >
        {leading}
        {entry.label}
        {trailing ? <DropdownMenuShortcut>{trailing}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    </WithTooltip>
  );
}

export function MobileTabTrailingAccessory({
  menuTestIDBase,
  presentationLabel,
  menuEntries,
}: {
  menuTestIDBase: string;
  presentationLabel: string;
  menuEntries: WorkspaceTabMenuEntry[];
}): ReactElement {
  const { t } = useTranslation();
  return (
    // The accessory sits inside a sessions-list row (a Command item): a press or key here, or in
    // the portaled menu (React events bubble through portals), must not also select the row.
    <span className="contents" onClick={stopPropagation} onKeyDown={stopPropagation}>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid={`${menuTestIDBase}-trigger`}
          aria-label={t("workspace.tabs.menu.openFor", { label: presentationLabel })}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground active:bg-muted aria-expanded:bg-muted"
        >
          <Ellipsis size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          data-testid={menuTestIDBase}
          className="w-[220px]"
          onCloseAutoFocus={keepFocusElsewhere}
        >
          {menuEntries.map((entry) =>
            entry.kind === "separator" ? (
              <DropdownMenuSeparator key={entry.key} />
            ) : (
              <MobileTabDropdownMenuItem key={entry.key} entry={entry} />
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}
