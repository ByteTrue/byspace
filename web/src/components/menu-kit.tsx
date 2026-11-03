import type { ComponentProps, ComponentType } from "react";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "~/components/adaptive-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/adaptive-menu";

/**
 * The menu primitives an item list renders with. The same list shows in a kebab dropdown and a
 * right-click context menu, as in the Expo app; Radix keeps those two primitive sets separate.
 */
export interface MenuKit {
  Item: ComponentType<ComponentProps<typeof DropdownMenuItem>>;
  CheckboxItem: ComponentType<ComponentProps<typeof DropdownMenuCheckboxItem>>;
  Label: ComponentType<ComponentProps<typeof DropdownMenuLabel>>;
  Separator: ComponentType<ComponentProps<typeof DropdownMenuSeparator>>;
  Sub: ComponentType<ComponentProps<typeof DropdownMenuSub>>;
  SubTrigger: ComponentType<ComponentProps<typeof DropdownMenuSubTrigger>>;
  SubContent: ComponentType<ComponentProps<typeof DropdownMenuSubContent>>;
}

export const dropdownMenuKit: MenuKit = {
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export const contextMenuKit: MenuKit = {
  Item: ContextMenuItem as MenuKit["Item"],
  CheckboxItem: ContextMenuCheckboxItem as MenuKit["CheckboxItem"],
  Label: ContextMenuLabel as MenuKit["Label"],
  Separator: ContextMenuSeparator as MenuKit["Separator"],
  Sub: ContextMenuSub as MenuKit["Sub"],
  SubTrigger: ContextMenuSubTrigger as MenuKit["SubTrigger"],
  SubContent: ContextMenuSubContent as MenuKit["SubContent"],
};

/** onSelect handler that runs the action but keeps the menu open (the Expo app's closeOnSelect={false}). */
export function keepOpen(action: () => void) {
  return (event: Event) => {
    event.preventDefault();
    action();
  };
}
