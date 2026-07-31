import { describe, expect, it } from "vitest";
import type { ExplorerDirectory, ExplorerEntry } from "@/stores/session-store";
import {
  MAX_AUTO_EXPANDED_DIRECTORY_DEPTH,
  flattenExplorerTree,
  normalizeExpandedPaths,
  reconcileRestoredExpandedPaths,
  restoreExpandedDirectories,
  setExpandedDirectoryPath,
  showHiddenFilesAndRestoreExpandedDirectories,
} from "./tree";

function makeDirectoryEntry(name: string, path: string): ExplorerEntry {
  return {
    name,
    path,
    kind: "directory",
    size: 0,
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeFileEntry(input: {
  name: string;
  path: string;
  size?: number;
  modifiedAt?: string;
}): ExplorerEntry {
  return {
    name: input.name,
    path: input.path,
    kind: "file",
    size: input.size ?? 0,
    modifiedAt: input.modifiedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("file explorer tree", () => {
  it("flattens a deeply expanded tree without consuming the call stack", () => {
    const depth = 10_000;
    const directories = new Map<string, ExplorerDirectory>();
    const expandedPaths = new Set<string>(["."]);
    let parentPath = ".";

    for (let index = 1; index <= depth; index += 1) {
      const childPath = `directory-${index}`;
      directories.set(parentPath, {
        path: parentPath,
        entries: [makeDirectoryEntry(childPath, childPath)],
      });
      expandedPaths.add(childPath);
      parentPath = childPath;
    }
    directories.set(parentPath, { path: parentPath, entries: [] });

    const rows = flattenExplorerTree({
      directories,
      expandedPaths,
      sortOption: "name",
      showHiddenFiles: true,
    });

    expect(rows).toHaveLength(depth);
    expect(rows[0]).toEqual({
      entry: makeDirectoryEntry("directory-1", "directory-1"),
      depth: 0,
    });
    expect(rows.at(-1)).toEqual({
      entry: makeDirectoryEntry(`directory-${depth}`, `directory-${depth}`),
      depth: depth - 1,
    });
  });

  it("ignores malformed, cyclic, and duplicate restored entries", () => {
    const directoryA = makeDirectoryEntry("a", "a");
    const file = makeFileEntry({ name: "z.ts", path: "z.ts" });
    const directories = new Map<string, unknown>([
      [
        ".",
        {
          path: ".",
          entries: [
            file,
            directoryA,
            directoryA,
            makeDirectoryEntry(".hidden", ".hidden"),
            { name: "broken", path: null, kind: "directory" },
          ],
        },
      ],
      [
        "a",
        {
          path: "a",
          entries: [
            makeDirectoryEntry("root-cycle", "."),
            makeDirectoryEntry("missing", "a/missing"),
            file,
          ],
        },
      ],
      [
        "a/missing",
        {
          path: "wrong-path",
          entries: [makeFileEntry({ name: "leaked.ts", path: "wrong-path/leaked.ts" })],
        },
      ],
    ]);

    const rows = flattenExplorerTree({
      directories,
      expandedPaths: new Set([".", "a", "a/missing", ".hidden"]),
      sortOption: "name",
      showHiddenFiles: false,
    });

    expect(rows).toEqual([
      { entry: directoryA, depth: 0 },
      { entry: makeDirectoryEntry("missing", "a/missing"), depth: 1 },
      { entry: file, depth: 0 },
    ]);
  });

  it("sorts directories first and files by each selected field with stable name ties", () => {
    const directory = makeDirectoryEntry("folder", "folder");
    const oldestLarge = makeFileEntry({
      name: "b.ts",
      path: "b.ts",
      size: 20,
      modifiedAt: "2025-01-01T00:00:00.000Z",
    });
    const newestSmall = makeFileEntry({
      name: "a.ts",
      path: "a.ts",
      size: 10,
      modifiedAt: "2026-01-01T00:00:00.000Z",
    });
    const directories = new Map<string, ExplorerDirectory>([
      [".", { path: ".", entries: [oldestLarge, newestSmall, directory] }],
    ]);
    const pathsForSort = (sortOption: "name" | "modified" | "size") =>
      flattenExplorerTree({
        directories,
        expandedPaths: new Set(["."]),
        sortOption,
        showHiddenFiles: true,
      }).map((row) => row.entry.path);

    expect(pathsForSort("name")).toEqual(["folder", "a.ts", "b.ts"]);
    expect(pathsForSort("modified")).toEqual(["folder", "a.ts", "b.ts"]);
    expect(pathsForSort("size")).toEqual(["folder", "b.ts", "a.ts"]);
  });

  it("flattens a large expanded directory without spreading its rows into the parent", () => {
    const fileCount = 150_000;
    const files = Array.from(
      { length: fileCount },
      (_, index): ExplorerEntry =>
        makeFileEntry({
          name: `file-${index.toString().padStart(6, "0")}`,
          path: `generated/file-${index}`,
          size: index,
        }),
    );
    const child = makeDirectoryEntry("generated", "generated");
    const directories = new Map<string, ExplorerDirectory>([
      [".", { path: ".", entries: [child] }],
      ["generated", { path: "generated", entries: files }],
    ]);

    const rows = flattenExplorerTree({
      directories,
      expandedPaths: new Set([".", "generated"]),
      sortOption: "name",
      showHiddenFiles: true,
    });

    expect(rows).toHaveLength(fileCount + 1);
    expect(rows[0]).toEqual({ entry: child, depth: 0 });
    expect(rows.at(-1)).toEqual({ entry: files[fileCount - 1], depth: 1 });
  });

  it("restores five rendered directory levels rather than counting path segments", async () => {
    const paths = [
      "generated/cache/level-1",
      "generated/cache/level-1/level-2",
      "generated/cache/level-1/level-2/level-3",
      "generated/cache/level-1/level-2/level-3/level-4",
      "generated/cache/level-1/level-2/level-3/level-4/level-5",
      "generated/cache/level-1/level-2/level-3/level-4/level-5/level-6",
    ];
    const directories = new Map<string, ExplorerDirectory>();
    const rootDirectory = {
      path: ".",
      entries: [makeDirectoryEntry("level-1", paths[0])],
    };
    directories.set(".", rootDirectory);
    for (let index = 0; index < paths.length - 1; index += 1) {
      const path = paths[index];
      const childPath = paths[index + 1];
      if (path && childPath) {
        directories.set(path, {
          path,
          entries: [makeDirectoryEntry(`level-${index + 2}`, childPath)],
        });
      }
    }

    const requestedPaths: string[] = [];
    const expandedPaths = await restoreExpandedDirectories({
      rootDirectory,
      persistedExpandedPaths: new Set(paths),
      showHiddenFiles: true,
      requestDirectoryListing: async (path) => {
        requestedPaths.push(path);
        return directories.get(path) ?? null;
      },
    });

    expect(MAX_AUTO_EXPANDED_DIRECTORY_DEPTH).toBe(5);
    expect(requestedPaths).toEqual(paths.slice(0, 5));
    expect(expandedPaths).toEqual([".", ...paths.slice(0, 5)]);
  });

  it("does not restore missing parents, hidden entries, or mismatched listings", async () => {
    const rootDirectory = {
      path: ".",
      entries: [makeDirectoryEntry("parent", "parent"), makeDirectoryEntry(".hidden", ".hidden")],
    };
    const requestedPaths: string[] = [];

    const expandedPaths = await restoreExpandedDirectories({
      rootDirectory,
      persistedExpandedPaths: new Set(["parent", "parent/child", "missing/child", ".hidden"]),
      showHiddenFiles: false,
      requestDirectoryListing: async (path) => {
        requestedPaths.push(path);
        return { path: "different", entries: [] };
      },
    });

    expect(requestedPaths).toEqual(["parent"]);
    expect(expandedPaths).toEqual(["."]);
  });

  it("preserves an expanded path when its listing fails transiently", async () => {
    const rootDirectory = {
      path: ".",
      entries: [makeDirectoryEntry("parent", "parent")],
    };

    const expandedPaths = await restoreExpandedDirectories({
      rootDirectory,
      persistedExpandedPaths: new Set([".", "parent"]),
      showHiddenFiles: true,
      requestDirectoryListing: async () => null,
    });

    expect(expandedPaths).toEqual([".", "parent"]);
    expect(
      reconcileRestoredExpandedPaths({
        persistedExpandedPaths: new Set([".", "parent"]),
        currentExpandedPaths: new Set([".", "parent"]),
        restoredExpandedPaths: expandedPaths,
      }),
    ).toEqual([".", "parent"]);
  });

  it("preserves expansion changes made while persisted directories are restoring", () => {
    const paths = reconcileRestoredExpandedPaths({
      persistedExpandedPaths: new Set([".", "parent", "parent/child"]),
      currentExpandedPaths: new Set([".", "parent/child", "manual"]),
      restoredExpandedPaths: [".", "parent"],
    });

    expect(paths).toEqual([".", "manual"]);
  });

  it("normalizes malformed restored expansion paths and applies clicks to the latest state", () => {
    expect(normalizeExpandedPaths({ broken: true })).toEqual(["."]);
    expect(normalizeExpandedPaths(["restored", "restored", null, 3, ""])).toEqual([
      ".",
      "restored",
    ]);

    const expanded = setExpandedDirectoryPath({
      currentExpandedPaths: [".", "restored"],
      directoryPath: "manual",
      expanded: true,
    });
    const collapsed = setExpandedDirectoryPath({
      currentExpandedPaths: expanded,
      directoryPath: "manual",
      expanded: false,
    });

    expect(expanded).toEqual([".", "restored", "manual"]);
    expect(collapsed).toEqual([".", "restored"]);
  });

  it("shows hidden files before waiting for expanded directories to restore", async () => {
    const rootDirectory = {
      path: ".",
      entries: [makeDirectoryEntry(".hidden", ".hidden")],
    };
    let resolveDirectory!: (directory: ExplorerDirectory) => void;
    const directoryListing = new Promise<ExplorerDirectory>((resolve) => {
      resolveDirectory = resolve;
    });
    let hiddenFilesAreShown = false;

    const restoration = showHiddenFilesAndRestoreExpandedDirectories({
      rootDirectory,
      persistedExpandedPaths: new Set([".hidden"]),
      showHiddenFiles: () => {
        hiddenFilesAreShown = true;
      },
      requestDirectoryListing: () => directoryListing,
    });

    expect(hiddenFilesAreShown).toBe(true);
    resolveDirectory({ path: ".hidden", entries: [] });
    await expect(restoration).resolves.toEqual([".", ".hidden"]);
  });
});
