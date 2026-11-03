// Port of packages/app/src/composer/draft/import-pill.tsx: "Import session" as a pill above the
// new-agent composer.
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Import as ImportIcon } from "lucide-react";
import { composerPillClassName, composerPillLabelClassName } from "@/composer/pill-styles";

export function ComposerImportPill({
  onPress,
  disabled = false,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  return (
    <div className="flex">
      <button
        type="button"
        data-testid="composer-import-agent-pill"
        aria-label={t("importSession.title")}
        onClick={onPress}
        disabled={disabled}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className={composerPillClassName(isHovered, "disabled:opacity-50")}
      >
        <ImportIcon size={14} className="text-muted-foreground" />
        <span className={composerPillLabelClassName(isHovered)}>{t("importSession.title")}</span>
      </button>
    </div>
  );
}
