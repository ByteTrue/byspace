// Port of archive/expo-app:packages/app/src/components/ui/status-badge.tsx: shadcn's secondary badge, a 20px
// pill whose text takes the status colour.
import type { ReactNode } from "react";
import { cn } from "cn";

export type StatusBadgeVariant = "success" | "warning" | "error" | "muted";

const TEXT: Record<StatusBadgeVariant, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  error: "text-status-danger",
  muted: "text-foreground",
};

export function StatusBadge({
  label,
  variant = "muted",
  leading,
}: {
  label: string;
  variant?: StatusBadgeVariant;
  leading?: ReactNode;
}) {
  return (
    <span className="flex min-h-5 items-center gap-1 self-start rounded-full bg-muted px-2 py-0.5">
      {leading}
      <span className={cn("text-xs font-medium", TEXT[variant])}>{label}</span>
    </span>
  );
}
