// Port of archive/expo-app:packages/app/src/provider-usage/tooltip-section.tsx: the active agent's provider
// usage under the context meter's tooltip; nothing when that provider has no usage entry.
import { ProviderUsageCard } from "@/provider-usage/card";
import { providerUsageCopy } from "@/provider-usage/copy";
import type { ProviderUsage, ProviderUsageView } from "@/provider-usage/types";

function matchProvider(
  providers: ProviderUsage[],
  activeProviderId: string | null | undefined,
): ProviderUsage | null {
  if (!activeProviderId) return null;
  const target = activeProviderId.toLowerCase();
  return providers.find((usage) => usage.providerId.toLowerCase() === target) ?? null;
}

// The rule spans the tooltip edge to edge, in the tooltip's own outline colour.
const DIVIDER = <div className="-mx-2.5 my-2 h-px bg-border" />;

export function ProviderUsageTooltipSection({
  view,
  activeProviderId,
}: {
  view: ProviderUsageView;
  activeProviderId: string | null | undefined;
}) {
  if (view.kind === "loading") {
    return (
      <>
        {DIVIDER}
        <span className="text-xs leading-[16.8px] text-muted-foreground">
          {providerUsageCopy.tooltipLoading}
        </span>
      </>
    );
  }
  if (view.kind === "error") {
    return (
      <>
        {DIVIDER}
        <span className="text-xs leading-[16.8px] text-destructive">{view.message}</span>
      </>
    );
  }
  const usage = matchProvider(view.payload.providers, activeProviderId);
  if (!usage) return null;
  return (
    <>
      {DIVIDER}
      <ProviderUsageCard usage={usage} compact />
    </>
  );
}
