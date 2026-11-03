import type { CSSProperties } from "react";
import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { useMacTrafficLightInset } from "@/constants/layout";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID?: string;
}

/** The lone row at the top of a sidebar, clearing the macOS traffic lights in the desktop app. */
export function SidebarHeaderRow({ icon: Icon, label, onPress, testID }: SidebarHeaderRowProps) {
  const trafficLightInset = useMacTrafficLightInset();
  const containerStyle = useMemo<CSSProperties | undefined>(
    () => (trafficLightInset > 0 ? { paddingLeft: trafficLightInset } : undefined),
    [trafficLightInset],
  );
  return (
    <SidebarMenu style={containerStyle} data-wails-drag="true">
      <SidebarMenuItem>
        <SidebarMenuButton onClick={onPress} data-testid={testID} aria-label={label}>
          <Icon />
          <span>{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
