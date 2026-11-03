// Port of archive/expo-app:packages/app/src/components/provider-catalog-list.tsx: the searchable ACP provider catalog; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-catalog-list.py; edit it directly.
import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, PackagePlus, Search } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import {
  useAcpProviderCatalog,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { withTheme } from "~/app/theme-object";
import { SvgXml } from "~/components/svg-xml";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";

interface ProviderCatalogListProps {
  serverId: string;
  installingProviderId: string | null;
  onInstall: (entry: AcpProviderCatalogItem) => Promise<void> | void;
}

const PROVIDER_FALLBACK_ICON_SIZE = 20;
const PROVIDER_REMOTE_ICON_SIZE = 24;

const ThemedPackagePlus = withTheme(PackagePlus);
const ThemedSvgXml = withTheme(SvgXml);
const ThemedExternalLink = withTheme(ExternalLink);

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
            themeProps={foregroundColorMapping}
          />
        ) : (
          <ThemedPackagePlus
            size={PROVIDER_FALLBACK_ICON_SIZE}
            themeProps={foregroundColorMapping}
          />
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
          <ThemedExternalLink size={12} themeProps={foregroundMutedColorMapping} />
        </button>
      </div>
      <Button
        size="sm"
        variant="default"
        onClick={handleInstall}
        className="w-[92px] shrink-0"
        data-testid={`install-provider-${entry.id}`}
        disabled={installing}
      >
        {installing ? <Spinner data-icon="inline-start" /> : null}
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
  const handleSearchInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value),
    [setSearch],
  );

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
      <InputGroup className="mb-3">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          data-testid="provider-catalog-search"
          value={search}
          onChange={handleSearchInput}
          aria-label={t("providerCatalog.search")}
          placeholder={t("providerCatalog.search")}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </InputGroup>

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
