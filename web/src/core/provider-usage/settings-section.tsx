// Port of archive/expo-app:packages/app/src/provider-usage/settings-section.tsx: the Usage page section; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-usage-settings.py; edit it directly.
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { cn } from "cn";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { providerUsageCopy } from "@/provider-usage/copy";
import { ProviderUsageList } from "@/provider-usage/list";
import type { ProviderUsageView } from "@/provider-usage/types";

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
        leftIcon={RefreshCw}
        loading={busy}
        onPress={onRefresh}
        accessibilityLabel={providerUsageCopy.refresh}
      >
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
      <div className={cn(settingsStyles.card, "items-center p-4")}>
        <span className="text-sm leading-[normal] text-muted-foreground">
          {providerUsageCopy.loading}
        </span>
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <Alert variant="error" title={providerUsageCopy.errorTitle} description={view.message}>
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {providerUsageCopy.retry}
        </Button>
      </Alert>
    );
  }

  if (view.payload.providers.length === 0) {
    return (
      <div className={cn(settingsStyles.card, "items-center p-4")}>
        <span className="text-sm leading-[normal] text-muted-foreground">
          {providerUsageCopy.empty}
        </span>
      </div>
    );
  }

  return <ProviderUsageList providers={view.payload.providers} />;
}
