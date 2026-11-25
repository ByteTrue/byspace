import {
  compareMatchScores,
  scoreTextFields,
  type MatchScore,
} from "@bytetrue/protocol/search/text-match";

export interface SearchableCatalogEntry {
  id: string;
  title: string;
}

function compareTitles(a: SearchableCatalogEntry, b: SearchableCatalogEntry): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function rankProviderCatalog<T extends SearchableCatalogEntry>(
  entries: readonly T[],
  query: string,
): T[] {
  if (!query.trim()) return [...entries].sort(compareTitles);

  const scored: { entry: T; score: MatchScore }[] = [];
  for (const entry of entries) {
    const score = scoreTextFields(query, [entry.title, entry.id]);
    if (score) scored.push({ entry, score });
  }
  scored.sort((a, b) => compareMatchScores(a.score, b.score) || compareTitles(a.entry, b.entry));
  return scored.map(({ entry }) => entry);
}

export function filterConfiguredProviderCatalog<T extends SearchableCatalogEntry>(
  entries: readonly T[],
  configured: readonly { provider: string; enabled?: boolean }[],
): T[] {
  return entries.filter(
    (entry) => !configured.some((configuredEntry) => configuredEntry.provider === entry.id),
  );
}
