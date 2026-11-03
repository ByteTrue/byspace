// Port of archive/expo-app:packages/app/src/file-pane/conflict-alert.tsx: the amber strip under the file bar when
// the file changed or vanished on disk while it was being edited.
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { ICON_SIZE } from "@/styles/theme";

export type FileConflictAlertState =
  | { kind: "changed"; canOverwrite: boolean; onReload(): void; onOverwrite(): void }
  | { kind: "deleted" }
  | { kind: "checkFailed"; retrying: boolean; onRetry(): void };

export function FileConflictAlert({ state }: { state: FileConflictAlertState }) {
  const { t } = useTranslation();
  let title = t("panels.file.editor.changedOnDisk");
  if (state.kind === "deleted") title = t("panels.file.editor.deletedTitle");
  else if (state.kind === "checkFailed") title = t("panels.file.editor.checkFailedTitle");
  let description: string | undefined;
  if (state.kind !== "changed") description = t("panels.file.editor.preservedDescription");
  else if (state.canOverwrite) description = t("panels.file.editor.conflictDescription");

  return (
    <div
      role="alert"
      data-testid="file-conflict-alert"
      className="flex min-h-12 flex-wrap items-center gap-3 border-b border-amber-500 bg-card px-3 py-2"
    >
      <AlertTriangle size={ICON_SIZE.sm} className="shrink-0 text-amber-500" />
      <div className="flex min-w-0 flex-1 basis-[180px] flex-col gap-1">
        <span className="text-sm font-medium text-amber-600 dark:text-amber-500">{title}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      {state.kind !== "deleted" ? (
        <div className="ml-auto flex shrink-0 gap-2">
          {state.kind === "changed" && state.canOverwrite ? (
            <Button variant="outline" size="sm" onClick={state.onOverwrite}>
              {t("panels.file.editor.overwrite")}
            </Button>
          ) : null}
          {state.kind === "changed" ? (
            <Button variant="outline" size="sm" onClick={state.onReload}>
              {t("panels.file.editor.reload")}
            </Button>
          ) : null}
          {state.kind === "checkFailed" ? (
            <Button variant="outline" size="sm" onClick={state.onRetry} disabled={state.retrying}>
              {state.retrying ? <Spinner data-icon="inline-start" /> : null}
              {t("common.actions.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
