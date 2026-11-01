// Override of packages/app/src/provider-usage/list.tsx: the per-provider usage cards in one settings card; DOM view.
// Generated from the Expo file by web/scripts/port/provider-usage-settings.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
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
