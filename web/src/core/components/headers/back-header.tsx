// Port of packages/app/src/components/headers/back-header.tsx.
import { useCallback, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";

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
          <button
            type="button"
            onClick={handleBack}
            aria-label={t("common.actions.back")}
            className="rounded-lg p-3 text-muted-foreground hover:bg-accent md:p-2"
          >
            <ArrowLeft className="size-5" />
          </button>
          {title ? <ScreenTitle>{title}</ScreenTitle> : null}
          {titleAccessory}
        </>
      }
      right={rightContent}
    />
  );
}
