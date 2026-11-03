// Port of packages/app/src/provider-usage/list.tsx: the per-provider usage cards in one settings card; DOM view.
// Converted from the Expo file by web/scripts/port/provider-usage-settings.py (tag archive/expo-app); edit it directly.
import { Fragment } from "react";
import { settingsStyles } from "@/styles/settings";
import { ProviderUsageCard } from "@/provider-usage/card";
import type { ProviderUsage } from "@/provider-usage/types";

export function ProviderUsageList({ providers }: { providers: ProviderUsage[] }) {
  return (
    <div className={settingsStyles.card}>
      {providers.map((usage, index) => (
        <Fragment key={usage.providerId}>
          {index > 0 ? <div className="h-px bg-border" /> : null}
          <ProviderUsageCard usage={usage} />
        </Fragment>
      ))}
    </div>
  );
}
