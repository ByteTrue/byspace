import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, PackagePlus, Search } from "lucide-react";
import { Button } from "@/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/ui/item";
import { Spinner } from "@/ui/spinner";
import { SvgXml } from "@/platform/svg-xml";
import { openExternalUrl } from "@/platform/open-external-url";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  useAcpProviderCatalog,
  type AcpProviderCatalogItem,
} from "@/screens/use-acp-provider-catalog";
import {
  filterConfiguredProviderCatalog,
  rankProviderCatalog,
} from "@/screens/provider-catalog-search";

interface ProviderCatalogListProps {
  serverId: string;
  installingProviderId: string | null;
  onInstall: (entry: AcpProviderCatalogItem) => Promise<void> | void;
}

function CatalogRow({
  entry,
  installing,
  onInstall,
}: {
  entry: AcpProviderCatalogItem;
  installing: boolean;
  onInstall: (entry: AcpProviderCatalogItem) => void;
}) {
  const { t } = useTranslation();
  const handleInstall = useCallback(() => onInstall(entry), [entry, onInstall]);
  const handleOpenInstallLink = useCallback(() => {
    void openExternalUrl(entry.installLink);
  }, [entry.installLink]);

  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        {entry.iconSvg ? (
          <SvgXml xml={entry.iconSvg} width={24} height={24} color="currentColor" />
        ) : (
          <PackagePlus size={20} />
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
          aria-label={t("settings.providers.catalog.installInstructionsFor", {
            provider: entry.title,
          })}
          onClick={handleOpenInstallLink}
          className="max-w-full self-start"
        >
          <span className="truncate text-xs leading-[normal] text-muted-foreground">
            {t("settings.providers.catalog.installInstructions")}
          </span>
          <ExternalLink size={12} />
        </Button>
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant="default"
          onClick={handleInstall}
          className="w-[92px] shrink-0"
          data-testid={`install-provider-${entry.id}`}
          aria-label={t("settings.providers.catalog.addProvider", { provider: entry.title })}
          disabled={installing}
        >
          {installing ? <Spinner data-icon="inline-start" /> : null}
          {installing
            ? t("settings.providers.catalog.adding")
            : t("settings.providers.catalog.add")}
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
  const deferredSearch = useDeferredValue(search);
  const handleSearchInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value),
    [],
  );
  const availableEntries = useMemo(
    () =>
      providerEntries === undefined
        ? []
        : filterConfiguredProviderCatalog(
            rankProviderCatalog(catalogEntries, deferredSearch),
            providerEntries,
          ),
    [catalogEntries, deferredSearch, providerEntries],
  );

  let catalogContent: ReactNode;
  if (providerEntries === undefined) {
    catalogContent = (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  } else if (availableEntries.length === 0) {
    catalogContent = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{t("settings.providers.catalog.noProviders")}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  } else {
    catalogContent = (
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
    );
  }

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
          aria-label={t("settings.providers.catalog.search")}
          placeholder={t("settings.providers.catalog.search")}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </InputGroup>
      {catalogContent}
    </div>
  );
}
