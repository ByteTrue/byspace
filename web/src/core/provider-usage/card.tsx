// Port of archive/expo-app:packages/app/src/provider-usage/card.tsx: one provider's usage — name, plan, status,
// error, window and balance bars, detail rows and where the numbers came from.
import { getProviderIcon } from "@/components/provider-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProviderUsageBalanceBar } from "@/provider-usage/balance-bar";
import { formatAgo } from "@/provider-usage/format";
import type { ProviderUsage } from "@/provider-usage/types";
import { ProviderUsageWindowBar, useUsageTextTones } from "@/provider-usage/window-bar";
import { cn } from "cn";

function statusText(usage: ProviderUsage): string | null {
  if (usage.status === "available") return null;
  return usage.status === "error" ? "Error" : "Unavailable";
}

function footerText(usage: ProviderUsage): string | null {
  const updated = formatAgo(usage.fetchedAt);
  const parts = [usage.sourceLabel, updated ? `Updated ${updated}` : null].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ProviderUsageCard({
  usage,
  compact = false,
}: {
  usage: ProviderUsage;
  compact?: boolean;
}) {
  const tones = useUsageTextTones();
  const status = statusText(usage);
  const footer = footerText(usage);
  const balances = usage.balances ?? [];
  const details = usage.details ?? [];
  const Icon = getProviderIcon(usage.providerId);
  return (
    <div className={cn("flex flex-col", compact ? "gap-3" : "gap-4 p-4")}>
      <div className="flex items-center gap-2">
        <span className={cn("flex", tones.muted)}>
          <Icon size={14} color="currentColor" />
        </span>
        <span className={cn("min-w-0 shrink truncate text-sm leading-[normal]", tones.strong)}>
          {usage.displayName}
        </span>
        {usage.planLabel ? <StatusBadge label={usage.planLabel} variant="muted" /> : null}
        <span className="flex-1" />
        {status ? (
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full bg-muted-foreground",
                usage.status === "error" && "bg-status-danger",
              )}
            />
            <span className={cn("text-xs leading-[normal]", tones.muted)}>{status}</span>
          </span>
        ) : null}
      </div>
      {usage.error ? (
        <span className="line-clamp-3 text-xs leading-[16.8px] text-red-300">{usage.error}</span>
      ) : null}
      {usage.windows.length > 0 || balances.length > 0 ? (
        <div className="flex flex-col gap-3">
          {usage.windows.map((window) => (
            <ProviderUsageWindowBar key={window.id} window={window} />
          ))}
          {balances.map((balance) => (
            <ProviderUsageBalanceBar key={balance.id} balance={balance} />
          ))}
        </div>
      ) : null}
      {details.length > 0 ? (
        <div className="flex flex-col gap-1">
          {details.map((detail) => (
            <div key={detail.id} className="flex justify-between gap-2 text-xs leading-[normal]">
              <span className={cn("min-w-0 shrink truncate", tones.muted)}>{detail.label}</span>
              <span className={cn("truncate", tones.strong)}>{detail.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {footer ? (
        <span className={cn("truncate text-xs leading-[normal]", tones.muted)}>{footer}</span>
      ) : null}
    </div>
  );
}
