// Port of packages/app/src/components/headers/menu-header.tsx. The toggle is web/src/app's
// SidebarToggle; MenuHeader frames it like the Expo version does.
import type { ReactNode } from "react";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { SidebarToggle } from "~/app/sidebar-toggle";

export function SidebarMenuToggle({ host = "content" }: { host?: "sidebar" | "content" } = {}) {
  return <SidebarToggle host={host} />;
}

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
}

export function MenuHeader({ title, rightContent, borderless }: MenuHeaderProps) {
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title ? <ScreenTitle>{title}</ScreenTitle> : null}
        </>
      }
      right={rightContent}
      borderless={borderless}
    />
  );
}
