// Port of archive/expo-app:packages/app/src/components/headers/back-header.tsx.
import { useCallback, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { router } from "~/app/navigation";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "~/components/ui/button";

interface BackHeaderProps {
  title?: string;
  titleAccessory?: ReactNode;
  rightContent?: ReactNode;
  onBack?: () => void;
}

export function BackHeader({ title, titleAccessory, rightContent, onBack }: BackHeaderProps) {
  const { t } = useTranslation();
  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  }, [onBack]);
  return (
    <ScreenHeader
      left={
        <>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={handleBack}
            aria-label={t("common.actions.back")}
          >
            <ArrowLeft className="size-5" />
          </Button>
          {title ? <ScreenTitle>{title}</ScreenTitle> : null}
          {titleAccessory}
        </>
      }
      right={rightContent}
    />
  );
}
