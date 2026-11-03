// Port of archive/expo-app:packages/app/src/components/provider-catalog-list.tsx: the searchable ACP provider catalog; DOM view.
// Converted from the Expo file by archive/expo-app:web/scripts/port/provider-catalog-list.py; edit it directly.
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
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
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
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
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          <span className="truncate">{entry.title}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {entry.version}
          </span>
        </ItemTitle>
        <ItemDescription className="truncate">{entry.description || entry.id}</ItemDescription>
        <Button
          variant="link"
          size="xs"
          type="button"
          role="link"
          aria-label={t("providerCatalog.actions.installInstructionsFor", {
            provider: entry.title,
          })}
          onClick={handleOpenInstallLink}
          className="max-w-full self-start"
        >
          <span className="truncate text-xs leading-[normal] text-muted-foreground">
            {t("providerCatalog.actions.installInstructions")}
          </span>
          <ThemedExternalLink size={12} themeProps={foregroundMutedColorMapping} />
        </Button>
      </ItemContent>
      <ItemActions>
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
      </ItemActions>
    </Item>
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
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{t("providerCatalog.noProviders")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {availableEntries.map((entry) => (
            <CatalogRow
              key={entry.id}
              entry={entry}
              installing={installingProviderId === entry.id}
              onInstall={onInstall}
            />
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
