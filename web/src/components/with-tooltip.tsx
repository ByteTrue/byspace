import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

/** Short control/tab labels only. Information worth a card belongs in `InfoHoverCard`. */
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
