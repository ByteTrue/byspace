// Port of packages/app/src/components/ui/dropdown-menu.tsx: the press-to-open shape of the
// menu engine (components/ui/menu).
import { useCallback, type ReactElement } from "react";
import { MenuSurface, useMenuContext, type MenuSurfaceProps } from "@/components/ui/menu";

export {
  MenuHint as DropdownMenuHint,
  MenuItem as DropdownMenuItem,
  MenuLabel as DropdownMenuLabel,
  MenuRoot as DropdownMenu,
  MenuSeparator as DropdownMenuSeparator,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuTrigger as DropdownMenuTrigger,
} from "@/components/ui/menu";
export type {
  ActionStatus,
  MenuItemProps as DropdownMenuItemProps,
  MenuPageDefinition,
  MenuTriggerProps as DropdownMenuTriggerProps,
} from "@/components/ui/menu";

export function DropdownMenuContent(props: MenuSurfaceProps): ReactElement {
  return <MenuSurface {...props} />;
}

export function useDropdownMenuClose(): () => void {
  const { setOpen } = useMenuContext("useDropdownMenuClose");
  return useCallback(() => setOpen(false), [setOpen]);
}
