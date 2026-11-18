// The active file download as a Sonner toast: loading while it runs, then success or an error,
// keyed by the download so each update replaces it. On the web a download hands straight to the
// browser, so the toast mostly shows the result, or why the download link could not be made.
import { useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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

export function DownloadToast(): null {
  const { t } = useTranslation();
  const downloads = useDownloadStore((state) => state.downloads);
  const activeDownloadId = useDownloadStore((state) => state.activeDownloadId);
  const dismissDownload = useDownloadStore((state) => state.dismissDownload);
  const activeDownload = activeDownloadId ? downloads.get(activeDownloadId) : null;

  useEffect(() => {
    if (!activeDownload) return;
    const options = {
      id: activeDownload.id,
      description: getDownloadStatusText(activeDownload, t),
      testId: "download-toast",
      onDismiss: () => dismissDownload(activeDownload.id),
      onAutoClose: () => dismissDownload(activeDownload.id),
    };
    if (activeDownload.status === "downloading") {
      toast.loading(activeDownload.fileName, { ...options, duration: Number.POSITIVE_INFINITY });
    } else if (activeDownload.status === "complete") {
      toast.success(activeDownload.fileName, { ...options, duration: AUTO_DISMISS_DELAY });
    } else {
      toast.error(activeDownload.fileName, { ...options, duration: AUTO_DISMISS_DELAY });
    }
  }, [activeDownload, dismissDownload, t]);

  return null;
}
