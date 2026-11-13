import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { HostRuntimeBootstrapProvider } from "@/app/_layout";
import { AppearanceProvider } from "@/appearance/provider";
import { SidebarCalloutProvider } from "@/contexts/sidebar-callout-context";
import { ToastProvider } from "@/contexts/toast-context";
import { queryClient } from "@/data/query-client";
import { I18nProvider } from "@/i18n/provider";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { AppChrome } from "~/app/app-chrome";
import { DownloadToast } from "@/components/download-toast";
import { AppDiagnosticHost } from "@/components/app-diagnostic-host";
import { ChangelogHost } from "@/changelog";
import { ProviderSettingsHost } from "@/components/provider-settings-host";
import { ConfirmDialogHost } from "~/app/confirm-dialog-host";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import {
  AlertToastBridge,
  DraftFlushOnBackground,
  FaviconStatusSync,
  HostSessionManager,
  OfferLinkHost,
  PushNotificationRouter,
} from "~/app/global-listeners";
import { AddProjectFlowHost } from "@/components/add-project-flow-host";
import { RootErrorBoundary } from "~/app/root-error-boundary";
import { TooltipProvider } from "~/components/ui/tooltip";

// The provider order follows archive/expo-app:packages/app/src/app/_layout.tsx (RootLayout > RootProviders >
// RuntimeProviders > ProvidersWrapper).

function RootProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RootErrorBoundary>
          <KeyboardActionDispatcherProvider>
            <ToastProvider>
              <AlertToastBridge />
              {children}
            </ToastProvider>
          </KeyboardActionDispatcherProvider>
        </RootErrorBoundary>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <HostRuntimeBootstrapProvider>
      <PushNotificationRouter />
      <SidebarCalloutProvider>
        <AppearanceProvider>
          <OfferLinkHost />
          <HostSessionManager />
          <FaviconStatusSync />
          <DraftFlushOnBackground />
          {children}
        </AppearanceProvider>
      </SidebarCalloutProvider>
    </HostRuntimeBootstrapProvider>
  );
}

export function Root() {
  return (
    <RootProviders>
      <RuntimeProviders>
        <TooltipProvider delayDuration={300}>
          <AppChrome />
          <DownloadToast />
          <ConfirmDialogHost />
          <KeyboardShortcutsDialog />
          <AddProjectFlowHost />
          <ProviderSettingsHost />
          <ChangelogHost />
          <AppDiagnosticHost />
        </TooltipProvider>
      </RuntimeProviders>
    </RootProviders>
  );
}
