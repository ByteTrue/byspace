// Port of archive/expo-app:packages/app/src/changelog/internal/changelog-sheet.tsx: What's new — the release notes, revealed a few at a time. Same logic, DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/changelog-sheet.py; edit it directly.
import { memo, useCallback, useMemo } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { CircleAlert, ExternalLink, Gift } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import {
  iconButtonChromeClassName,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { Badge } from "~/components/ui/badge";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { resolveAppVersion } from "@/utils/app-version";
import { openExternalUrl } from "@/utils/open-external-url";
import { useChangelog, type ChangelogState } from "@/changelog/internal/changelog-source";
import { useRevealedReleases } from "@/changelog/internal/use-revealed-releases";
import {
  formatChangelogDate,
  type ChangelogRelease,
  type ChangelogSection,
} from "@/changelog/internal/parse-changelog";
import { withTheme } from "~/app/theme-object";

const WEBSITE_CHANGELOG_URL = "https://github.com/ByteTrue/byspace/releases";

const ThemedGift = withTheme(Gift);
const ThemedExternalLink = withTheme(ExternalLink);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const sheetLeadingIcon = <ThemedGift size={ICON_SIZE.md} themeProps={mutedColorMapping} />;
const WEBSITE_BUTTON = iconButtonChromeClassName({ size: "large" });

interface ChangelogSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangelogSheet({ visible, onClose }: ChangelogSheetProps) {
  const { t } = useTranslation();
  const { state, reload } = useChangelog(visible);
  const { count, showMore } = useRevealedReleases(visible && state.status === "ready");

  const handleOpenWebsite = useCallback(() => {
    void openExternalUrl(WEBSITE_CHANGELOG_URL);
  }, []);

  const header: SheetHeader = useMemo(
    () => ({
      title: t("changelog.title"),
      leading: sheetLeadingIcon,
      actions: (
        <button
          type="button"
          onClick={handleOpenWebsite}
          className={WEBSITE_BUTTON}
          aria-label={t("changelog.openWebsite")}
          data-testid="changelog-open-website"
        >
          <ThemedExternalLink
            size={iconButtonChromeGlyphSize("large")}
            themeProps={mutedColorMapping}
          />
        </button>
      ),
    }),
    [handleOpenWebsite, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      desktopMaxWidth={620}
      desktopHeight="85%"
      testID="changelog-sheet"
    >
      <ChangelogBody state={state} shownReleases={count} onShowMore={showMore} onRetry={reload} />
    </AdaptiveModalSheet>
  );
}

const SNAP_POINTS = ["85%", "95%"];

interface ChangelogBodyProps {
  state: ChangelogState;
  shownReleases: number;
  onShowMore: () => void;
  onRetry: () => void;
}

function ChangelogBody({ state, shownReleases, onShowMore, onRetry }: ChangelogBodyProps) {
  const { t } = useTranslation();
  const appVersion = useMemo(() => resolveAppVersion()?.replace(/^v/i, "") ?? null, []);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3">
        <Alert variant="destructive" data-testid="changelog-error">
          <CircleAlert />
          <AlertTitle>{t("changelog.error.title")}</AlertTitle>
          <AlertDescription>{t("changelog.error.description")}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onPress={onRetry} testID="changelog-retry">
              {t("common.actions.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  const visibleReleases = state.releases.slice(0, shownReleases);

  return (
    <div className="flex flex-col gap-8 pb-4">
      {visibleReleases.map((release) => (
        <ReleaseView
          key={`${release.version}:${release.date}`}
          release={release}
          isCurrent={release.version === appVersion}
        />
      ))}
      {state.releases.length > visibleReleases.length ? (
        <Button
          variant="ghost"
          onPress={onShowMore}
          className="self-center"
          testID="changelog-show-more"
        >
          {t("changelog.showMore")}
        </Button>
      ) : null}
    </div>
  );
}

interface ReleaseViewProps {
  release: ChangelogRelease;
  isCurrent: boolean;
}

const ReleaseView = memo(function ReleaseView({ release, isCurrent }: ReleaseViewProps) {
  const { t } = useTranslation();
  const date = formatChangelogDate(release.date);

  return (
    <div className="flex flex-col gap-4" data-testid={`changelog-release-${release.version}`}>
      <div className="flex flex-row items-center gap-2 border-b pb-2">
        <span className="text-base leading-[normal] font-medium text-foreground">
          {release.version}
        </span>
        {isCurrent ? <Badge variant="secondary">{t("changelog.installed")}</Badge> : null}
        <div className="flex-1" />
        {date ? (
          <span className="text-xs leading-[normal] text-muted-foreground">{date}</span>
        ) : null}
      </div>
      {keyChangelogSections(release.sections).map(({ key, section }) => (
        <div key={key} className="flex flex-col gap-2">
          {section.title ? (
            <span className="text-xs leading-[normal] font-medium tracking-[0.5px] text-muted-foreground uppercase">
              {section.title}
            </span>
          ) : null}
          {section.body ? <MarkdownRenderer text={section.body} compact /> : null}
        </div>
      ))}
    </div>
  );
});

/** A release can repeat a section title; the occurrence keeps the key stable. */
function keyChangelogSections(
  sections: readonly ChangelogSection[],
): { key: string; section: ChangelogSection }[] {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const title = section.title ?? "";
    const occurrence = seen.get(title) ?? 0;
    seen.set(title, occurrence + 1);
    return { key: `${title}:${occurrence}`, section };
  });
}
