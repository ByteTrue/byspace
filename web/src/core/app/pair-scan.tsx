// Port of archive/expo-app:packages/app/src/app/pair-scan.tsx: QR pairing. The Expo app's file renders the
// camera on native and, on web, a card that says scanning is not available; the web build only has
// that branch, so the camera code (expo-camera) is not carried over.
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "~/app/navigation";
import { BackHeader } from "@/components/headers/back-header";

export default function PairScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const closeToSource = useCallback(() => {
    try {
      router.back();
    } catch {
      router.replace("/" as Href);
    }
  }, [router]);
  const handleRouterBack = useCallback(() => router.back(), [router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <BackHeader title={t("pairing.scan.title")} onBack={handleRouterBack} />
      <div className="flex flex-1 flex-col px-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="mt-6 flex flex-col gap-4 rounded-[14px] bg-muted p-6">
          <span className="text-sm leading-[normal] font-semibold text-foreground">
            {t("pairing.scan.webUnavailableTitle")}
          </span>
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("pairing.scan.webUnavailableBody")}
          </span>
          <button
            type="button"
            onClick={closeToSource}
            className="self-start rounded-[10px] bg-[#3b82f6] px-6 py-3 text-sm leading-[normal] font-semibold text-white"
          >
            {t("pairing.scan.backToSettings")}
          </button>
        </div>
      </div>
    </div>
  );
}
