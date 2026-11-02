// Override of packages/app/src/components/ui/alert.tsx on shadcn's Alert. Same props: the variant
// colours the border, title and icon (success keeps the plain border), a string description is
// muted text, and children are a row of actions under it.
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import { Alert as ShadAlert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { cn } from "cn";

export type AlertVariant = "default" | "info" | "success" | "warning" | "error";

export interface AlertProps {
  title?: string;
  description?: ReactNode;
  variant?: AlertVariant;
  icon?: ReactNode;
  children?: ReactNode;
  testID?: string;
}

const VARIANT_ICON: Record<Exclude<AlertVariant, "default">, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const ACCENT: Record<AlertVariant, { border: string; text: string }> = {
  default: { border: "", text: "" },
  info: { border: "border-blue-300", text: "text-blue-300" },
  success: { border: "", text: "text-status-success" },
  warning: { border: "border-amber-500", text: "text-amber-500" },
  error: { border: "border-destructive", text: "text-destructive" },
};

export function Alert({
  title,
  description,
  variant = "default",
  icon,
  children,
  testID,
}: AlertProps) {
  const accent = ACCENT[variant];
  let resolvedIcon: ReactNode = icon ?? null;
  if (icon === undefined && variant !== "default") {
    const Icon = VARIANT_ICON[variant];
    resolvedIcon = <Icon className={cn("size-3.5", accent.text)} />;
  }
  const hasDescription = description != null && description !== "";
  return (
    // packages/app's Alert geometry: a 14px-radius hairline box on the page background, 12/16
    // padding, a 14px icon 12px from the text, 4px between title and description (a margin: the
    // icon spans two grid rows, so a row gap would pad an alert with no description).
    <ShadAlert
      className={cn(
        "gap-y-0 rounded-[14px] bg-transparent px-4 py-3 has-[>svg]:gap-x-3",
        accent.border,
      )}
      data-testid={testID}
    >
      {resolvedIcon}
      {title ? <AlertTitle className={accent.text}>{title}</AlertTitle> : null}
      {hasDescription ? (
        <AlertDescription
          className={cn(
            "text-xs",
            title && "mt-1",
            typeof description !== "string" && "flex flex-col gap-2",
          )}
        >
          {description}
        </AlertDescription>
      ) : null}
      {children ? (
        <div className="mt-2 flex gap-2 group-has-[>svg]/alert:col-start-2">{children}</div>
      ) : null}
    </ShadAlert>
  );
}
