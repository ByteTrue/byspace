// Override of packages/app/src/components/sidebar/sidebar-header-row.tsx: the lone row at the top
// of a sidebar (the settings sidebar's "Back to workspace"), 36px tall on desktop and 56px on a
// phone, clearing the macOS traffic lights in the desktop app.
import type { CSSProperties } from "react";
import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { useMacTrafficLightInset } from "@/constants/layout";
import { ICON_SIZE } from "@/styles/theme";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID?: string;
}

export function SidebarHeaderRow({ icon: Icon, label, onPress, testID }: SidebarHeaderRowProps) {
  const trafficLightInset = useMacTrafficLightInset();
  const containerStyle = useMemo<CSSProperties | undefined>(
    () => (trafficLightInset > 0 ? { paddingLeft: 8 + trafficLightInset } : undefined),
    [trafficLightInset],
  );
  return (
    <div
      className="flex h-14 flex-col justify-center px-2 select-none md:h-9"
      style={containerStyle}
      data-wails-drag="true"
    >
      <button
        type="button"
        onClick={onPress}
        data-testid={testID}
        aria-label={label}
        className="group/header-row relative flex min-h-[34px] items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Icon
          size={ICON_SIZE.sm}
          className="text-muted-foreground group-hover/header-row:text-foreground"
        />
        <span className="text-sm text-muted-foreground group-hover/header-row:text-foreground">
          {label}
        </span>
      </button>
    </div>
  );
}
