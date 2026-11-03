// Port of archive/expo-app:packages/app/src/provider-usage/list.tsx: the per-provider usage cards in one settings card; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-usage-settings.py; edit it directly.
import { Separator } from "~/components/ui/separator";
import { Fragment } from "react";
import { ProviderUsageCard } from "@/provider-usage/card";
import type { ProviderUsage } from "@/provider-usage/types";
import { ItemGroup } from "~/components/ui/item";

export function ProviderUsageList({ providers }: { providers: ProviderUsage[] }) {
  return (
    <ItemGroup>
      {providers.map((usage, index) => (
        <Fragment key={usage.providerId}>
          {index > 0 ? <Separator /> : null}
          <ProviderUsageCard usage={usage} />
        </Fragment>
      ))}
    </ItemGroup>
  );
}
