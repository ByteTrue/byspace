import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/ui/sidebar";

/**
 * The desktop sidebar's top row, for every route: 36px, matching the height of the content card's
 * ScreenHeader beside it.
 */
export function SidebarTopBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <SidebarHeader
      className={cn("h-9 shrink-0 flex-row items-center gap-1 px-3 pt-0 pb-px", className)}
    >
      {children}
    </SidebarHeader>
  );
}

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID?: string;
}

/** A sidebar whose top row is one button (Settings' Back). */
export function SidebarHeaderRow({ icon: Icon, label, onPress, testID }: SidebarHeaderRowProps) {
  return (
    <SidebarTopBar className="px-2">
      <SidebarMenu className="w-auto">
        <SidebarMenuItem>
          <SidebarMenuButton onClick={onPress} data-testid={testID} aria-label={label}>
            <Icon />
            <span>{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarTopBar>
  );
}
