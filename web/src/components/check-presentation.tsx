import { CircleCheck, CircleDot, CircleSlash, CircleX } from "lucide-react";
import type { CheckPresentation } from "@/git/check-presentation";
import { cn } from "cn";
import { ManualStatusIcon } from "~/components/forge-icon";

export type CheckPresentationTone = "success" | "danger" | "warning" | "muted";

// archive/expo-app:packages/app/src/git/check-presentation.view.tsx: one icon and tone per check presentation.
const POLICY: Record<
  CheckPresentation,
  { tone: CheckPresentationTone; Icon: typeof CircleCheck | typeof ManualStatusIcon }
> = {
  success: { tone: "success", Icon: CircleCheck },
  failure: { tone: "danger", Icon: CircleX },
  warning: { tone: "warning", Icon: CircleX },
  actionRequired: { tone: "warning", Icon: ManualStatusIcon },
  manual: { tone: "muted", Icon: ManualStatusIcon },
  pending: { tone: "warning", Icon: CircleDot },
  ignored: { tone: "muted", Icon: CircleSlash },
};

export const CHECK_TONE_CLASS: Record<CheckPresentationTone, string> = {
  success: "text-status-success",
  danger: "text-status-danger",
  warning: "text-status-warning",
  muted: "text-muted-foreground",
};

export function getCheckPresentationTone(presentation: CheckPresentation): CheckPresentationTone {
  return POLICY[presentation].tone;
}

export function CheckPresentationIcon({
  presentation,
  className,
}: {
  presentation: CheckPresentation;
  className?: string;
}) {
  const { tone, Icon } = POLICY[presentation];
  return <Icon className={cn("size-3 shrink-0", CHECK_TONE_CLASS[tone], className)} />;
}
