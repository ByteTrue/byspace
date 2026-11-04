import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { useMacTrafficLightInset } from "@/constants/layout";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";

/**
 * The desktop sidebar's top row, for every route: 36px, the height of the content card's
 * ScreenHeader beside it, so both sit on the row the macOS traffic lights are centered on
 * (internal/gui/titlebar_darwin.go), and clearing the lights in the desktop app.
 */
export function SidebarTopBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const trafficLightInset = useMacTrafficLightInset();
  const style = useMemo<CSSProperties | undefined>(
    () => (trafficLightInset > 0 ? { paddingLeft: 12 + trafficLightInset } : undefined),
    [trafficLightInset],
  );
  return (
    <SidebarHeader
      data-wails-drag="true"
      className={cn("h-9 shrink-0 flex-row items-center gap-1 px-3 py-0", className)}
      style={style}
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
