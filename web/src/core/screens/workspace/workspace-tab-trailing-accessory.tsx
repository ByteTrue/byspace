// Port of archive/expo-app:packages/app/src/screens/workspace/workspace-tab-trailing-accessory.tsx: the "..."
// beside each row of the phone tab switcher, holding that tab's menu.
import { useMemo, type ReactElement } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";

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
    <DropdownMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </DropdownMenuItem>
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
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID={`${menuTestIDBase}-trigger`}
        accessibilityLabel={t("workspace.tabs.menu.openFor", { label: presentationLabel })}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground active:bg-muted aria-expanded:bg-muted"
      >
        <Ellipsis size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        width={220}
        sheetTitle={presentationLabel}
        testID={menuTestIDBase}
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
  );
}
