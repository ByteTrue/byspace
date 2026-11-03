// Port of archive/expo-app:packages/app/src/composer/draft/import-pill.tsx: "Import session" as a pill above the
// new-agent composer.
import { useTranslation } from "react-i18next";
import { Import as ImportIcon } from "lucide-react";
import { Button } from "~/components/ui/button";

export function ComposerImportPill({
  onPress,
  disabled = false,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex">
      <Button
        variant="outline"
        type="button"
        data-testid="composer-import-agent-pill"
        aria-label={t("importSession.title")}
        onClick={onPress}
        disabled={disabled}
      >
        <ImportIcon data-icon="inline-start" />
        {t("importSession.title")}
      </Button>
    </div>
  );
}
