// Port of packages/app/src/components/file-change-icon.tsx: the file's change kind beside its
// diff stat — the square plus, minus and dot in the status colours, labelled for screen readers.
import type { ReactElement } from "react";
import { SquareDot, SquareMinus, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

const ICON_SIZE = 14;

export function FileChangeIcon({
  change,
}: {
  change: "added" | "deleted" | "modified";
}): ReactElement {
  const { t } = useTranslation();
  if (change === "added") {
    return (
      <SquarePlus
        size={ICON_SIZE}
        className="shrink-0 text-status-success"
        aria-label={t("workspace.git.diff.newFile")}
      />
    );
  }
  if (change === "deleted") {
    return (
      <SquareMinus
        size={ICON_SIZE}
        className="shrink-0 text-status-danger"
        aria-label={t("workspace.git.diff.deletedFile")}
      />
    );
  }
  return (
    <SquareDot
      size={ICON_SIZE}
      className="shrink-0 text-status-warning"
      aria-label={t("workspace.git.diff.modifiedFile")}
    />
  );
}
