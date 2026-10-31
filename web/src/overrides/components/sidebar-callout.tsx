// Override of packages/app/src/components/sidebar-callout.tsx: the same callout card (title, body,
// up to two actions, optional dismiss) on shadcn's Card and Button.
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "cn";
import { Button } from "~/components/ui/button";

export type SidebarCalloutActionVariant = "primary" | "secondary";

export interface SidebarCalloutAction {
  label: string;
  onPress: () => void;
  variant?: SidebarCalloutActionVariant;
  disabled?: boolean;
  testID?: string;
}

export type SidebarCalloutVariant = "default" | "success" | "error";

export interface SidebarCalloutProps {
  title?: string;
  description?: ReactNode;
  icon?: ReactNode;
  variant?: SidebarCalloutVariant;
  actions?: readonly SidebarCalloutAction[];
  onDismiss?: () => void;
  testID?: string;
}

export function SidebarCalloutDescriptionText({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function SidebarCallout({
  title,
  description,
  icon,
  variant = "default",
  actions,
  onDismiss,
  testID,
}: SidebarCalloutProps) {
  const { t } = useTranslation();
  const visibleActions = (actions ?? []).slice(0, 2);
  const hasHeader = title != null || icon != null;
  const hasDescription = description != null && description !== "";

  return (
    <div
      role="alert"
      data-testid={testID}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm shadow-xs",
        variant === "error" && "border-destructive/40",
      )}
    >
      {hasHeader || onDismiss ? (
        <div className="flex items-start gap-2">
          {hasHeader ? (
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
              {title ? <p className="line-clamp-2 font-medium">{title}</p> : null}
            </div>
          ) : null}
          {onDismiss ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="-mt-1 -mr-1 ml-auto text-muted-foreground"
              data-testid={testID ? `${testID}-dismiss` : undefined}
              aria-label={t("sidebarCallout.dismiss")}
              onClick={onDismiss}
            >
              <X />
            </Button>
          ) : null}
        </div>
      ) : null}
      {hasDescription && typeof description === "string" ? (
        <SidebarCalloutDescriptionText>{description}</SidebarCalloutDescriptionText>
      ) : null}
      {hasDescription && typeof description !== "string" ? <div>{description}</div> : null}
      {visibleActions.length > 0 ? (
        <div className="flex gap-2" data-testid={testID ? `${testID}-actions` : undefined}>
          {visibleActions.map((action, index) => (
            <Button
              key={action.label}
              size="sm"
              variant={action.variant === "primary" ? "default" : "outline"}
              className="flex-1"
              disabled={action.disabled}
              data-testid={action.testID ?? (testID ? `${testID}-action-${index}` : undefined)}
              onClick={action.onPress}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
