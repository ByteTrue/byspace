// Override of packages/app/src/components/provider-catalog-list.tsx: the searchable ACP provider catalog; DOM view.
// Generated from the Expo file by web/scripts/port/provider-catalog-list.py.
// After changing either file, rerun it and then npm run format:files; do not edit by hand.
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SvgXml } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import { ExternalLink, PackagePlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAcpProviderCatalog,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";

interface ProviderCatalogListProps {
  serverId: string;
  installingProviderId: string | null;
  onInstall: (entry: AcpProviderCatalogItem) => Promise<void> | void;
}

const SEARCH_ICON_SIZE = 16;
const PROVIDER_FALLBACK_ICON_SIZE = 20;
const PROVIDER_REMOTE_ICON_SIZE = 24;

const ThemedPackagePlus = withUnistyles(PackagePlus);
const ThemedSvgXml = withUnistyles(SvgXml);
const ThemedSearch = withUnistyles(Search);
const ThemedExternalLink = withUnistyles(ExternalLink);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function matchesSearch(entry: AcpProviderCatalogItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [entry.title, entry.id, entry.description].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

interface CatalogRowProps {
  entry: AcpProviderCatalogItem;
  installing: boolean;
  onInstall: (entry: AcpProviderCatalogItem) => void;
}

function CatalogRow({ entry, installing, onInstall }: CatalogRowProps) {
  const { t } = useTranslation();
  const actionLabel = installing
    ? t("providerCatalog.actions.adding")
    : t("providerCatalog.actions.add");
  const handleInstall = useCallback(() => {
    onInstall(entry);
  }, [entry, onInstall]);

  const handleOpenInstallLink = useCallback(() => {
    void openExternalUrl(entry.installLink);
  }, [entry.installLink]);

  return (
    <div className="flex flex-row items-center gap-3 border-b p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        {entry.iconSvg ? (
          <ThemedSvgXml
            xml={entry.iconSvg}
            width={PROVIDER_REMOTE_ICON_SIZE}
            height={PROVIDER_REMOTE_ICON_SIZE}
            uniProps={foregroundColorMapping}
          />
        ) : (
          <ThemedPackagePlus size={PROVIDER_FALLBACK_ICON_SIZE} uniProps={foregroundColorMapping} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-row items-center gap-2">
          <span className="shrink truncate text-sm leading-[normal] font-medium text-foreground">
            {entry.title}
          </span>
          <span className="shrink-0 truncate text-xs leading-[normal] text-muted-foreground">
            {entry.version}
          </span>
        </div>
        <span className="truncate text-xs leading-[normal] text-muted-foreground">
          {entry.description || entry.id}
        </span>
        <button
          type="button"
          role="link"
          aria-label={t("providerCatalog.actions.installInstructionsFor", {
            provider: entry.title,
          })}
          onClick={handleOpenInstallLink}
          className="flex max-w-full flex-row items-center gap-1 self-start text-left"
        >
          <span className="truncate text-xs leading-[normal] text-muted-foreground">
            {t("providerCatalog.actions.installInstructions")}
          </span>
          <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
        </button>
      </div>
      <Button
        size="sm"
        variant="default"
        disabled={installing}
        loading={installing}
        onPress={handleInstall}
        className="w-[92px] shrink-0"
        testID={`install-provider-${entry.id}`}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

export function ProviderCatalogList({
  serverId,
  installingProviderId,
  onInstall,
}: ProviderCatalogListProps) {
  const { t } = useTranslation();
  const { entries: catalogEntries } = useAcpProviderCatalog();
  const { entries: providerEntries } = useProvidersSnapshot(serverId);
  const [search, setSearch] = useState("");

  const installedIds = useMemo(
    () => new Set(providerEntries?.map((entry) => entry.provider) ?? []),
    [providerEntries],
  );

  const availableEntries = useMemo(
    () =>
      catalogEntries
        .filter((entry) => !installedIds.has(entry.id))
        .filter((entry) => matchesSearch(entry, search)),
    [catalogEntries, installedIds, search],
  );

  return (
    <div>
      <div className="mb-3 flex flex-row items-center gap-2 rounded-lg border bg-muted px-3">
        <div className="flex w-[18px] items-center justify-center">
          <ThemedSearch size={SEARCH_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
        </div>
        <TextInput
          testID="provider-catalog-search"
          initialValue={search}
          onChangeText={setSearch}
          accessibilityLabel={t("providerCatalog.search")}
          placeholder={t("providerCatalog.search")}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm leading-[normal] text-foreground outline-none placeholder:text-muted-foreground"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </div>

      {availableEntries.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-lg border bg-card p-4">
          <span className="text-sm leading-[normal] text-muted-foreground">
            {t("providerCatalog.noProviders")}
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {availableEntries.map((entry) => (
            <CatalogRow
              key={entry.id}
              entry={entry}
              installing={installingProviderId === entry.id}
              onInstall={onInstall}
            />
          ))}
        </div>
      )}
    </div>
  );
}
