// A menu as a bottom sheet, for phones: content-sized, the root page under its title or a sub page
// under its own title and a back button. Both menu stacks render their sheets with these pieces —
// the menu engine override (@/components/ui/menu) and the shadcn-shaped ~/components/adaptive-menu.
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Drawer as DrawerPrimitive } from "vaul";
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
  titleVisible = false,
  testID,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the sheet for assistive tech; the visible headers are the pages' own. */
  title: string;
  /** A page heading shows the title and names the sheet (MenuSheetHeader asSheetTitle). */
  titleVisible?: boolean;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* The test id goes on the page (`<id>-content`) only, as the Expo app's sheet carries it on
          its scroll view and not on the sheet. */}
      <DrawerContent
        aria-describedby={undefined}
        // The Expo app's menu sheets (menu-surface.tsx): a 14px radius and a 1px border (its bottom
        // edge sits below the screen there), and a 36px handle in surface2, 10px below the sheet's edge
        className="border border-b-0 bg-background data-[vaul-drawer-direction=bottom]:rounded-t-[14px]"
      >
        {/* With a visible heading, the heading is the title (asSheetTitle), so its text is on the
            page once, as in the Expo app's sheets. */}
        {titleVisible ? null : <DrawerTitle className="sr-only">{title}</DrawerTitle>}
        <div
          role="menu"
          // The Expo app's MenuPage pads its rows 4px above and below, and the sheet adds 4px plus
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
  asSheetTitle = false,
}: {
  title: ReactNode;
  onBack: (() => void) | null;
  /** Names the sheet: pair with MenuSheet's titleVisible. */
  asSheetTitle?: boolean;
}) {
  const { t } = useTranslation();
  const titleText = (
    <span className="min-w-0 shrink truncate text-sm leading-[normal] font-medium text-foreground">
      {title}
    </span>
  );
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
      {asSheetTitle ? (
        <DrawerPrimitive.Title asChild>{titleText}</DrawerPrimitive.Title>
      ) : (
        titleText
      )}
    </div>
  );
}
