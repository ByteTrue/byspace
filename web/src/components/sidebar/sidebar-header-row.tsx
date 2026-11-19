import type { LucideIcon } from "lucide-react";
import { SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/ui/sidebar";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID?: string;
}

/** A sidebar whose top row is one button (Settings' Back). */
export function SidebarHeaderRow({ icon: Icon, label, onPress, testID }: SidebarHeaderRowProps) {
  return (
    <SidebarHeader className="h-9 shrink-0 flex-row items-center gap-1 px-2 pt-0 pb-px">
      <SidebarMenu className="w-auto">
        <SidebarMenuItem>
          <SidebarMenuButton onClick={onPress} data-testid={testID} aria-label={label}>
            <Icon />
            <span>{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
