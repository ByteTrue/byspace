// Port of archive/expo-app:packages/app/src/provider-usage/settings-section.tsx: the Usage page section; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-usage-settings.py; edit it directly.
import { CircleAlert, RefreshCw } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { useMemo } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { providerUsageCopy } from "@/provider-usage/copy";
import { ProviderUsageList } from "@/provider-usage/list";
import type { ProviderUsageView } from "@/provider-usage/types";
import { ItemGroup } from "~/components/ui/item";

export function ProviderUsageSettingsSection({
  view,
  onRefresh,
}: {
  view: ProviderUsageView;
  onRefresh: () => void;
}) {
  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);

  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        aria-label={providerUsageCopy.refresh}
        disabled={busy}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
        {busy ? providerUsageCopy.refreshing : providerUsageCopy.refresh}
      </Button>
    ),
    [busy, onRefresh],
  );

  return (
    <SettingsSection
      title={providerUsageCopy.title}
      testID="provider-usage-card"
      trailing={refreshButton}
    >
      <ProviderUsageBody view={view} onRefresh={onRefresh} />
    </SettingsSection>
  );
}

function ProviderUsageBody({
  view,
  onRefresh,
}: {
  view: ProviderUsageView;
  onRefresh: () => void;
}) {
  if (view.kind === "loading") {
    return (
      <ItemGroup className="items-center p-4">
        <span className="text-sm leading-[normal] text-muted-foreground">
          {providerUsageCopy.loading}
        </span>
      </ItemGroup>
    );
  }

  if (view.kind === "error") {
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>{providerUsageCopy.errorTitle}</AlertTitle>
        <AlertDescription>{view.message}</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            {providerUsageCopy.retry}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (view.payload.providers.length === 0) {
    return (
      <ItemGroup className="items-center p-4">
        <span className="text-sm leading-[normal] text-muted-foreground">
          {providerUsageCopy.empty}
        </span>
      </ItemGroup>
    );
  }

  return <ProviderUsageList providers={view.payload.providers} />;
}
