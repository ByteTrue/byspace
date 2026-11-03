// Port of archive/expo-app:packages/app/src/app/pair-scan.tsx: QR pairing. The Expo app's file renders the
// camera on native and, on web, a card that says scanning is not available; the web build only has
// that branch, so the camera code (expo-camera) is not carried over.
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "~/app/navigation";
import { BackHeader } from "@/components/headers/back-header";
import { Button } from "~/components/ui/button";

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
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("pairing.scan.webUnavailableTitle")}</CardTitle>
            <CardDescription>{t("pairing.scan.webUnavailableBody")}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button type="button" onClick={closeToSource}>
              {t("pairing.scan.backToSettings")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
