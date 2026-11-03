// Port of packages/app/src/git/diff-too-large-state.tsx: the notice shown instead of a diff too
// large to preview.
import { FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "@/styles/theme";

export function DiffTooLargeState() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pt-16"
      data-testid="diff-too-large"
    >
      <FileWarning size={ICON_SIZE.lg} className="text-muted-foreground" />
      <div className="flex max-w-[360px] flex-col items-center gap-1 text-center">
        <span className="text-sm text-foreground">
          {t("workspace.git.diff.previewTooLargeTitle")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("workspace.git.diff.previewTooLargeDescription")}
        </span>
      </div>
    </div>
  );
}
