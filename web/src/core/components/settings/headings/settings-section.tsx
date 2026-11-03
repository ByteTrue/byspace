// Port of archive/expo-app:packages/app/src/components/settings/headings/settings-section.tsx: the one section
// primitive across settings — a muted header (optional info tip, collapsed summary, trailing
// slot) over its children; collapsible sections toggle from the header.
import { ChevronRight } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { ICON_SIZE } from "@/styles/theme";
import { cn } from "cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";

interface SettingsSectionProps {
  title: string;
  /** What this section is for, as an info tooltip on the header. */
  info?: ReactNode;
  trailing?: ReactNode;
  testID?: string;
  style?: CSSProperties;
  /** Drops the bottom margin, for the last section of a SettingsGroup. */
  flush?: boolean;
  /** Makes the section a disclosure: the header toggles it. */
  collapsible?: boolean;
  /** Opens folded. */
  defaultCollapsed?: boolean;
  /** Summary shown on the header while collapsed. */
  collapsedSummary?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({
  title,
  info,
  trailing,
  testID,
  style,
  flush,
  collapsible = false,
  defaultCollapsed = false,
  collapsedSummary,
  children,
}: SettingsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  const header = (
    // min-w-0 as the Expo app's title row (a react-native-web View): on a phone a wide trailing slot
    // squeezes the title instead of pushing the trailing controls out.
    <span className="flex min-w-0 shrink items-center gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      {info ? (
        <SettingsInfoTip title={title} info={info} testID={testID ? `${testID}-info` : undefined} />
      ) : null}
      {collapsible && !isExpanded && collapsedSummary ? (
        <span className="shrink truncate text-xs text-muted-foreground">{collapsedSummary}</span>
      ) : null}
    </span>
  );

  return (
    <Collapsible
      open={!collapsible || isExpanded}
      onOpenChange={setIsExpanded}
      className={cn("flex flex-col", !flush && "mb-6")}
      style={style}
      data-testid={testID}
    >
      <div className="mb-3 ml-1 flex items-center justify-between gap-2">
        {collapsible ? (
          <CollapsibleTrigger
            aria-label={title}
            className="flex flex-1 items-center gap-2 text-left"
            data-testid={testID ? `${testID}-toggle` : undefined}
          >
            {header}
            <ChevronRight
              size={ICON_SIZE.sm}
              className={cn("shrink-0 text-muted-foreground", isExpanded && "rotate-90")}
            />
          </CollapsibleTrigger>
        ) : (
          header
        )}
        {trailing}
      </div>
      <CollapsibleContent className="flex flex-col gap-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
