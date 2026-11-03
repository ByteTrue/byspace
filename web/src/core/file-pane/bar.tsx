// Port of archive/expo-app:packages/app/src/file-pane/bar.tsx: the strip over a file — size and lines, editor
// status, Vim mode and cursor, the Preview/Source switch — and the conflict alert under it.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FileConflictAlert, type FileConflictAlertState } from "@/file-pane/conflict-alert";
import type { FileEditorStatus } from "@/file-pane/editor/model";
import { Spinner } from "~/components/ui/spinner";

export function FilePanelBar({
  size,
  lineCount,
  mode,
  onModeChange,
  editorStatus,
  cursor,
  vimMode,
  conflict,
}: {
  size: number;
  lineCount?: number;
  mode?: "preview" | "source";
  onModeChange?(mode: "preview" | "source"): void;
  editorStatus?: FileEditorStatus;
  cursor?: { line: number; column: number };
  vimMode?: string | null;
  conflict?: FileConflictAlertState;
}) {
  const { t } = useTranslation();
  const previewModes = useMemo(
    () => [
      {
        value: "preview" as const,
        label: t("panels.file.editor.preview"),
        testID: "file-mode-preview",
      },
      {
        value: "source" as const,
        label: t("panels.file.editor.source"),
        testID: "file-mode-source",
      },
    ],
    [t],
  );
  return (
    <div className="shrink-0">
      <PaneContentToolbar testID="file-panel-bar">
        <div className="flex h-full items-center gap-3 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-extra-muted-foreground">
            <span aria-label={t("panels.file.editor.fileSize", { size: formatFileSize(size) })}>
              {formatFileSize(size)}
            </span>
            {lineCount !== undefined ? (
              <span aria-label={t("panels.file.editor.lines", { count: lineCount })}>
                {t("panels.file.editor.lines", { count: lineCount })}
              </span>
            ) : null}
          </div>
          <div
            className="flex shrink-0 items-center gap-2 text-xs"
            aria-label={
              editorStatus
                ? t("panels.file.editor.editorStatus", { status: editorStatus })
                : undefined
            }
          >
            {editorStatus === "dirty" ? (
              <span
                className="size-1.5 rounded-full bg-extra-muted-foreground"
                aria-label={t("panels.file.editor.unsavedChanges")}
              />
            ) : null}
            {editorStatus === "saving" ? (
              <>
                <Spinner className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{t("panels.file.editor.saving")}</span>
              </>
            ) : null}
            {editorStatus === "error" ? (
              <span className="text-destructive">{t("panels.file.editor.saveFailed")}</span>
            ) : null}
            {vimMode ? (
              <span
                className="font-mono text-muted-foreground"
                aria-label={t("panels.file.editor.vimMode", { mode: vimMode })}
              >
                {vimMode}
              </span>
            ) : null}
            {cursor ? (
              <span
                className="text-extra-muted-foreground"
                aria-label={t("panels.file.editor.cursor", cursor)}
              >
                Ln {cursor.line}, Col {cursor.column}
              </span>
            ) : null}
          </div>
          {mode && onModeChange ? (
            <SegmentedControl
              size="xs"
              value={mode}
              onValueChange={onModeChange}
              testID="file-preview-mode"
              options={previewModes}
            />
          ) : null}
        </div>
      </PaneContentToolbar>
      {conflict ? <FileConflictAlert state={conflict} /> : null}
    </div>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
