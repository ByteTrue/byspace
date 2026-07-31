import type { ExplorerDirectory, ExplorerEntry } from "@/stores/session-store";
import type { SortOption } from "@/stores/panel-store/state";
import { filterVisibleExplorerEntries } from "./visibility";

export const MAX_AUTO_EXPANDED_DIRECTORY_DEPTH = 5;

export interface ExplorerTreeRow {
  entry: ExplorerEntry;
  depth: number;
}

interface FlattenExplorerTreeInput {
  directories: ReadonlyMap<string, unknown>;
  expandedPaths: ReadonlySet<string>;
  sortOption: SortOption;
  showHiddenFiles: boolean;
}

interface RestoreExpandedDirectoriesInput {
  rootDirectory: ExplorerDirectory;
  persistedExpandedPaths: ReadonlySet<string>;
  showHiddenFiles: boolean;
  requestDirectoryListing: (path: string) => Promise<ExplorerDirectory | null>;
}

interface ShowHiddenFilesAndRestoreExpandedDirectoriesInput extends Omit<
  RestoreExpandedDirectoriesInput,
  "showHiddenFiles"
> {
  showHiddenFiles: () => void;
}

interface ReconcileRestoredExpandedPathsInput {
  persistedExpandedPaths: ReadonlySet<string>;
  currentExpandedPaths: ReadonlySet<string>;
  restoredExpandedPaths: string[];
}

interface SetExpandedDirectoryPathInput {
  currentExpandedPaths: readonly string[];
  directoryPath: string;
  expanded: boolean;
}

export function normalizeExpandedPaths(value: unknown): string[] {
  const paths = new Set<string>(["."]);
  if (!Array.isArray(value)) {
    return Array.from(paths);
  }
  for (const path of value) {
    if (typeof path === "string" && path.length > 0) {
      paths.add(path);
    }
  }
  return Array.from(paths);
}

export function flattenExplorerTree({
  directories,
  expandedPaths,
  sortOption,
  showHiddenFiles,
}: FlattenExplorerTreeInput): ExplorerTreeRow[] {
  const root = directories.get(".");
  if (!isExplorerDirectory(root)) {
    return [];
  }

  const rows: ExplorerTreeRow[] = [];
  const seenPaths = new Set<string>(["."]);
  const pending = rowsForDirectory(root, 0, sortOption, showHiddenFiles, seenPaths).toReversed();

  while (pending.length > 0) {
    const row = pending.pop();
    if (!row) {
      break;
    }
    rows.push(row);

    const entry = row.entry;
    if (entry.kind !== "directory" || !expandedPaths.has(entry.path)) {
      continue;
    }
    const childDirectory = directories.get(entry.path);
    if (!isExplorerDirectory(childDirectory) || childDirectory.path !== entry.path) {
      continue;
    }
    const childRows = rowsForDirectory(
      childDirectory,
      row.depth + 1,
      sortOption,
      showHiddenFiles,
      seenPaths,
    );
    for (let index = childRows.length - 1; index >= 0; index -= 1) {
      const childRow = childRows[index];
      if (childRow) {
        pending.push(childRow);
      }
    }
  }

  return rows;
}

export async function restoreExpandedDirectories({
  rootDirectory,
  persistedExpandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
}: RestoreExpandedDirectoriesInput): Promise<string[]> {
  if (!isExplorerDirectory(rootDirectory)) {
    return ["."];
  }

  const restoredPaths = ["."];
  const restoredPathSet = new Set(restoredPaths);
  let parentDirectories = [rootDirectory];

  for (let depth = 1; depth <= MAX_AUTO_EXPANDED_DIRECTORY_DEPTH; depth += 1) {
    const pathsToRequest: string[] = [];
    for (const directory of parentDirectories) {
      const entries = visibleEntries(directory, showHiddenFiles);
      for (const entry of entries) {
        const shouldRestore = entry.kind === "directory" && persistedExpandedPaths.has(entry.path);
        if (shouldRestore && !restoredPathSet.has(entry.path)) {
          pathsToRequest.push(entry.path);
          restoredPathSet.add(entry.path);
        }
      }
    }
    if (pathsToRequest.length === 0) {
      break;
    }

    const requestedDirectories = await Promise.all(
      pathsToRequest.map(async (path) => ({
        path,
        directory: await requestDirectoryListing(path),
      })),
    );
    parentDirectories = [];
    for (const { path, directory } of requestedDirectories) {
      if (directory === null) {
        restoredPaths.push(path);
        continue;
      }
      if (!isExplorerDirectory(directory) || directory.path !== path) {
        continue;
      }
      restoredPaths.push(path);
      parentDirectories.push(directory);
    }
  }

  return restoredPaths;
}

export function showHiddenFilesAndRestoreExpandedDirectories({
  rootDirectory,
  persistedExpandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
}: ShowHiddenFilesAndRestoreExpandedDirectoriesInput): Promise<string[]> {
  showHiddenFiles();
  return restoreExpandedDirectories({
    rootDirectory,
    persistedExpandedPaths,
    showHiddenFiles: true,
    requestDirectoryListing,
  });
}

export function reconcileRestoredExpandedPaths({
  persistedExpandedPaths,
  currentExpandedPaths,
  restoredExpandedPaths,
}: ReconcileRestoredExpandedPathsInput): string[] {
  const reconciledPaths = new Set(restoredExpandedPaths);

  for (const path of persistedExpandedPaths) {
    if (!currentExpandedPaths.has(path)) {
      reconciledPaths.delete(path);
    }
  }
  for (const path of currentExpandedPaths) {
    if (!persistedExpandedPaths.has(path)) {
      reconciledPaths.add(path);
    }
  }

  return normalizeExpandedPaths(Array.from(reconciledPaths));
}

export function setExpandedDirectoryPath({
  currentExpandedPaths,
  directoryPath,
  expanded,
}: SetExpandedDirectoryPathInput): string[] {
  const nextPaths = new Set(normalizeExpandedPaths(currentExpandedPaths));
  if (expanded) {
    nextPaths.add(directoryPath);
  } else {
    nextPaths.delete(directoryPath);
  }
  return normalizeExpandedPaths(Array.from(nextPaths));
}

function rowsForDirectory(
  directory: ExplorerDirectory,
  depth: number,
  sortOption: SortOption,
  showHiddenFiles: boolean,
  seenPaths: Set<string>,
): ExplorerTreeRow[] {
  const sortedEntries = sortExplorerEntries(visibleEntries(directory, showHiddenFiles), sortOption);
  const rows: ExplorerTreeRow[] = [];
  for (const entry of sortedEntries) {
    if (seenPaths.has(entry.path)) {
      continue;
    }
    seenPaths.add(entry.path);
    rows.push({ entry, depth });
  }
  return rows;
}

function visibleEntries(directory: ExplorerDirectory, showHiddenFiles: boolean): ExplorerEntry[] {
  if (!Array.isArray(directory.entries)) {
    return [];
  }
  const validEntries = directory.entries.filter(isExplorerEntry);
  return filterVisibleExplorerEntries(validEntries, showHiddenFiles);
}

function sortExplorerEntries(entries: ExplorerEntry[], sortOption: SortOption): ExplorerEntry[] {
  const sorted = [...entries];
  sorted.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    if (sortOption === "modified") {
      const comparison = timestamp(right.modifiedAt) - timestamp(left.modifiedAt);
      if (comparison !== 0) {
        return comparison;
      }
    } else if (sortOption === "size") {
      const comparison = right.size - left.size;
      if (comparison !== 0) {
        return comparison;
      }
    }
    return left.name.localeCompare(right.name);
  });
  return sorted;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isExplorerDirectory(value: unknown): value is ExplorerDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    "entries" in value &&
    Array.isArray(value.entries)
  );
}

function isExplorerEntry(value: unknown): value is ExplorerEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "name" in value &&
    typeof value.name === "string" &&
    "path" in value &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    "kind" in value &&
    (value.kind === "file" || value.kind === "directory") &&
    "size" in value &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    "modifiedAt" in value &&
    typeof value.modifiedAt === "string"
  );
}
