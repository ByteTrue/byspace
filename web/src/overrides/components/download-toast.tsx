// Override of packages/app/src/components/download-toast.tsx: the bar along the bottom of the
// window for the active file download — spinner while it runs, a check or an error when it ends,
// dismissed automatically 3 seconds after it ends. On the web a download hands straight to the
// browser, so the bar mostly shows the result, or why the download link could not be made.
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Check, X, XCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useDownloadStore, formatSpeed, formatEta, type Download } from "@/stores/download-store";

const AUTO_DISMISS_DELAY = 3000;

function getDownloadStatusText(download: Download, t: TFunction): string {
  if (download.status === "downloading") {
    if (download.progress) {
      return `${Math.round(download.progress.percent * 100)}% · ${formatSpeed(download.progress.speed)} · ${formatEta(download.progress.eta)}`;
    }
    return t("common.states.starting");
  }
  if (download.status === "complete") return t("common.states.downloadComplete");
  return download.message ?? t("common.states.downloadFailed");
}

export function DownloadToast() {
  const { t } = useTranslation();
  const downloads = useDownloadStore((state) => state.downloads);
  const activeDownloadId = useDownloadStore((state) => state.activeDownloadId);
  const dismissDownload = useDownloadStore((state) => state.dismissDownload);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeDownload = activeDownloadId ? downloads.get(activeDownloadId) : null;

  useEffect(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
    if (activeDownload && activeDownload.status !== "downloading") {
      dismissTimeoutRef.current = setTimeout(() => {
        dismissDownload(activeDownload.id);
      }, AUTO_DISMISS_DELAY);
    }
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, [activeDownload, dismissDownload]);

  const handleDismiss = useCallback(() => {
    if (activeDownload) {
      dismissDownload(activeDownload.id);
    }
  }, [activeDownload, dismissDownload]);

  if (!activeDownload) {
    return null;
  }

  const percent = activeDownload.progress ? Math.round(activeDownload.progress.percent * 100) : 0;
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[1000]"
      data-testid="download-toast"
    >
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-[10px] border bg-muted px-4 py-3 shadow-md"
        role="status"
      >
        {activeDownload.status === "downloading" ? (
          <LoadingSpinner size="small" className="text-foreground" />
        ) : null}
        {activeDownload.status === "complete" ? <Check size={18} className="text-primary" /> : null}
        {activeDownload.status !== "downloading" && activeDownload.status !== "complete" ? (
          <XCircle size={18} className="text-destructive" />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-semibold text-foreground">
            {activeDownload.fileName}
          </span>
          <span className="text-xs text-muted-foreground">
            {getDownloadStatusText(activeDownload, t)}
          </span>
          {activeDownload.status === "downloading" && activeDownload.progress ? (
            <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-background">
              <ProgressFill percent={percent} />
            </div>
          ) : null}
        </div>
        {activeDownload.status !== "downloading" ? (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("common.actions.dismiss")}
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProgressFill({ percent }: { percent: number }) {
  const style = useMemo(() => ({ width: `${percent}%` }), [percent]);
  return <div className="h-full rounded-full bg-primary" style={style} />;
}
