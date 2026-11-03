// Port of archive/expo-app:packages/app/src/components/ui/external-link.tsx: the inline "Docs ↗" link — muted
// text and an arrow, opened with the platform's external opener, with an optional tooltip.
import { useCallback, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openExternalUrl } from "@/utils/open-external-url";

interface ExternalLinkProps {
  href: string;
  label: string;
  tooltip?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}

export function ExternalLink({
  href,
  label,
  tooltip,
  testID,
  accessibilityLabel,
}: ExternalLinkProps) {
  const handlePress = useCallback(() => {
    void openExternalUrl(href);
  }, [href]);

  const trigger = (
    <button
      type="button"
      role="link"
      onClick={handlePress}
      aria-label={accessibilityLabel ?? label}
      data-testid={testID}
      className="flex items-center gap-1 rounded-none text-xs text-muted-foreground hover:text-foreground"
    >
      {label}
      <ArrowUpRight size={12} />
    </button>
  );

  if (!tooltip) {
    return trigger;
  }

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="top" align="end" offset={6}>
        <span className="text-sm leading-[1.4]">{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}
