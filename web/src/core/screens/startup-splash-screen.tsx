// Port of packages/app/src/screens/startup-splash-screen.tsx: the same splash (logo shimmer
// while hosts connect, an error page with recovery actions) in shadcn/ui.
import * as Clipboard from "expo-clipboard";
import { useCallback, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Copy, RotateCw, TriangleAlert } from "lucide-react";
import { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX } from "@/components/icons/byspace-logo-path";
import { openExternalUrl } from "@/utils/open-external-url";
import { BySpaceLogo } from "~/components/byspace-logo";
import { Button } from "~/components/ui/button";

interface StartupSplashScreenProps {
  bootstrapState?: {
    splashError: string | null;
    retry: () => void;
  };
}

const GITHUB_ISSUE_URL = "https://github.com/ByteTrue/byspace/issues/new";
const DOCS_URL = "https://github.com/ByteTrue/byspace/tree/main/public-docs";

const LOGO_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${BYSPACE_LOGO_VIEWBOX}'><path fill='black' d='${BYSPACE_LOGO_PATH}'/></svg>`,
)}")`;
const SHIMMER_STYLE: CSSProperties = { maskImage: LOGO_MASK, WebkitMaskImage: LOGO_MASK };

export function StartupSplashScreen({ bootstrapState }: StartupSplashScreenProps) {
  const { t } = useTranslation();
  const splashError = bootstrapState?.splashError ?? null;
  const copyLogs = useCallback(() => {
    void Clipboard.setStringAsync(splashError ?? "");
  }, [splashError]);
  const openIssue = useCallback(() => void openExternalUrl(GITHUB_ISSUE_URL), []);
  const openDocs = useCallback(() => void openExternalUrl(DOCS_URL), []);

  if (!bootstrapState || splashError === null) {
    return (
      <div data-testid="startup-splash" className="flex h-full items-center justify-center">
        <div
          className="splash-shimmer size-24 mask-contain mask-center mask-no-repeat"
          style={SHIMMER_STYLE}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16">
        <div className="flex items-center gap-3">
          <BySpaceLogo className="size-16" />
          <h1 className="text-xl font-semibold">{t("startup.errorTitle")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("startup.errorDescription")}</p>
        <pre className="rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
          {splashError}
        </pre>
        <p className="font-mono text-xs text-muted-foreground select-text">
          {t("startup.logs.hint")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={copyLogs}>
            <Copy />
            Copy logs
          </Button>
          <Button variant="outline" onClick={openIssue}>
            <TriangleAlert />
            Open GitHub issue
          </Button>
          <Button variant="outline" onClick={openDocs}>
            <BookOpen />
            Docs
          </Button>
          <Button onClick={bootstrapState.retry}>
            <RotateCw />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}
