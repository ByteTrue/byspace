// A menu as a bottom sheet, for phones: content-sized, the root page under its title or a sub page
// under its own title and a back button. Both menu stacks render their sheets with these pieces —
// the menu engine override (@/components/ui/menu) and the shadcn-shaped ~/components/adaptive-menu.
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Drawer, DrawerContent, DrawerTitle } from "~/components/ui/drawer";

/** A sheet row: 40px, inset 4px from the sheet edge, highlighted while pressed. */
export const SHEET_ROW =
  "relative mx-1 flex min-h-10 w-[calc(100%-8px)] items-center gap-2 rounded-md border border-transparent px-2 text-left text-sm outline-none select-none active:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export const SHEET_LABEL = "px-3 py-1.5 text-xs font-medium text-muted-foreground";
export const SHEET_SEPARATOR = "my-1 h-px bg-border";

export function MenuSheet({
  open,
  onOpenChange,
  title,
  testID,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the sheet for assistive tech; the visible headers are the pages' own. */
  title: string;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid={testID}
        aria-describedby={undefined}
        className="bg-background"
        // packages/app's menu sheets: a 36px handle in surface2 (menu-surface.tsx)
        handleClassName="w-9 bg-muted"
      >
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <div
          role="menu"
          // packages/app's MenuPage pads its rows 4px above and below, and the sheet adds 4px plus
          // the safe area under that; a header sits outside the page, so with one the 4px above
          // moves into the header's bottom padding.
          className="min-h-0 overflow-y-auto pt-1 pb-[calc(env(safe-area-inset-bottom)+8px)] has-[[data-slot=menu-sheet-header]]:pt-0"
          data-testid={testID ? `${testID}-content` : undefined}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function MenuSheetHeader({
  title,
  onBack,
}: {
  title: ReactNode;
  onBack: (() => void) | null;
}) {
  const { t } = useTranslation();
  return (
    <div data-slot="menu-sheet-header" className="flex items-center gap-2 px-3 pt-1 pb-4">
      {onBack ? (
        <button
          type="button"
          aria-label={t("common.back")}
          onClick={onBack}
          data-testid="menu-sheet-back"
          className="flex size-6 items-center justify-center text-muted-foreground"
        >
          <ChevronLeft size={18} />
        </button>
      ) : null}
      <span className="min-w-0 shrink truncate text-sm leading-[normal] font-medium text-foreground">
        {title}
      </span>
    </div>
  );
}
