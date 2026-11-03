// Port of archive/expo-app:packages/app/src/provider-usage/balance-bar.tsx: a balance's label and amount, with
// a bar when there is a limit to measure against.
import { useMemo } from "react";
import { clampPct, formatAmount, formatResetLabel } from "@/provider-usage/format";
import type { ProviderUsageBalance } from "@/provider-usage/types";
import { FILL_TONE, useUsageTextTones } from "@/provider-usage/window-bar";
import { cn } from "cn";

function resolveBalance(balance: ProviderUsageBalance): {
  amountText: string;
  usedPct: number | null;
} {
  const { used, remaining, limit, unit } = balance;
  if (limit != null && limit > 0) {
    const usedAmount = used ?? (remaining != null ? limit - remaining : null);
    const usedPct = usedAmount != null ? (usedAmount / limit) * 100 : null;
    const usedText = usedAmount != null ? formatAmount(usedAmount, unit) : "—";
    return { amountText: `${usedText} / ${formatAmount(limit, unit)}`, usedPct };
  }
  if (remaining != null)
    return { amountText: `${formatAmount(remaining, unit)} left`, usedPct: null };
  if (used != null) return { amountText: formatAmount(used, unit), usedPct: null };
  return { amountText: "—", usedPct: null };
}

export function ProviderUsageBalanceBar({ balance }: { balance: ProviderUsageBalance }) {
  const tones = useUsageTextTones();
  const { amountText, usedPct } = resolveBalance(balance);
  const resetLabel = formatResetLabel(balance.resetsAt);
  const fillWidth = clampPct(usedPct ?? 0);
  const fillStyle = useMemo(() => ({ width: `${fillWidth}%` }), [fillWidth]);
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("min-w-0 shrink truncate", tones.muted)}>{balance.label}</span>
        <span className={cn("font-medium", tones.strong)}>
          {amountText}
          {resetLabel ? (
            <span className={cn("font-normal", tones.muted)}>{` · ${resetLabel}`}</span>
          ) : null}
        </span>
      </div>
      {usedPct != null ? (
        <div className={cn("h-1 overflow-hidden rounded-full", tones.track)}>
          <div
            className={cn("h-1 rounded-full", FILL_TONE[balance.tone ?? "default"])}
            style={fillStyle}
          />
        </div>
      ) : null}
    </div>
  );
}
