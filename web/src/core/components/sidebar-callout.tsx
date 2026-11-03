// Port of archive/expo-app:packages/app/src/components/sidebar-callout.tsx: the card the sidebar shows above its
// footer (worktree setup hints and the like). Same props, testIDs and geometry: a full-width band
// under a hairline, actions sharing the row.
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
  return <p className="text-xs text-muted-foreground">{children}</p>;
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
  const hasDescription = description != null && description !== "";
  return (
    <div
      role="alert"
      data-testid={testID}
      className={cn(
        "flex w-full flex-col gap-2 border-t px-4 py-3",
        variant === "error" && "border-destructive",
      )}
    >
      {title != null || icon != null || onDismiss ? (
        <div className="flex items-start gap-2">
          {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
          {title ? (
            <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-[normal]">{title}</p>
          ) : (
            <span className="flex-1" />
          )}
          {onDismiss ? (
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={onDismiss}
              aria-label={t("sidebarCallout.dismiss")}
              data-testid={testID ? `${testID}-dismiss` : undefined}
              className="shrink-0"
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {hasDescription && typeof description === "string" ? (
        <SidebarCalloutDescriptionText>{description}</SidebarCalloutDescriptionText>
      ) : null}
      {hasDescription && typeof description !== "string" ? <div>{description}</div> : null}
      {visibleActions.length > 0 ? (
        <div className="mt-2 flex gap-2" data-testid={testID ? `${testID}-actions` : undefined}>
          {visibleActions.map((action, index) => (
            <Button
              type="button"
              key={action.label}
              variant={action.variant === "primary" ? "default" : "outline"}
              size="sm"
              className="min-w-0 flex-1"
              disabled={action.disabled}
              onClick={action.onPress}
              data-testid={action.testID ?? (testID ? `${testID}-action-${index}` : undefined)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
