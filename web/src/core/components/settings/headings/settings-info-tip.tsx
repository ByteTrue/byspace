// Port of archive/expo-app:packages/app/src/components/settings/headings/settings-info-tip.tsx: the info icon on
// a settings header that opens a tooltip explaining it (never a paragraph under the header).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { ICON_SIZE } from "@/styles/theme";

interface SettingsInfoTipProps {
  /** Header the tip belongs to; used for the accessibility label. */
  title: string;
  info: ReactNode;
  testID?: string;
}

export function SettingsInfoTip({ title, info, testID }: SettingsInfoTipProps) {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("settings.groupInfo", { title })}
          data-testid={testID}
          className="-ml-1 flex rounded-none p-1 text-muted-foreground"
        >
          <Info size={ICON_SIZE.sm} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <span className="text-sm leading-[1.4]">{info}</span>
      </TooltipContent>
    </Tooltip>
  );
}
