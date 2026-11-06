// Port of archive/expo-app:packages/app/src/components/settings/headings/settings-info-tip.tsx: the info icon on
// a settings header that opens a tooltip explaining it (never a paragraph under the header).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import {
  InfoHoverCard,
  InfoHoverCardContent,
  InfoHoverCardTrigger,
} from "~/components/info-hover-card";
import { ICON_SIZE } from "@/styles/theme";
import { Button } from "~/components/ui/button";

interface SettingsInfoTipProps {
  /** Header the tip belongs to; used for the accessibility label. */
  title: string;
  info: ReactNode;
  testID?: string;
}

export function SettingsInfoTip({ title, info, testID }: SettingsInfoTipProps) {
  const { t } = useTranslation();
  return (
    <InfoHoverCard>
      <InfoHoverCardTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={t("settings.groupInfo", { title })}
          data-testid={testID}
          className="-ml-1"
        >
          <Info size={ICON_SIZE.sm} />
        </Button>
      </InfoHoverCardTrigger>
      <InfoHoverCardContent side="top" align="start">
        {info}
      </InfoHoverCardContent>
    </InfoHoverCard>
  );
}
