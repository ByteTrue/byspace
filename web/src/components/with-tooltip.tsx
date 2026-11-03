import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

/** `children` with a shadcn tooltip when there is something to say, else `children` alone. */
export function WithTooltip({
  tooltip,
  side = "right",
  children,
}: {
  tooltip: string | undefined;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}): ReactElement {
  if (!tooltip) return children;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
