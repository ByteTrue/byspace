import { Outlet } from "react-router";
import { AppProviders } from "~/app/providers";
import { AppSidebar } from "~/app/app-sidebar";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";

/** The window: sidebar on the left, the page in an inset card on the right. */
export function AppShell() {
  return (
    <AppProviders>
      <TooltipProvider>
        <SidebarProvider className="h-svh">
          <AppSidebar />
          <SidebarInset className="min-h-0 overflow-hidden">
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </AppProviders>
  );
}
