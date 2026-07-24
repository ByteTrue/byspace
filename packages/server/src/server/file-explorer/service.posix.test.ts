// POSIX-only: symlink fixtures
/* eslint-disable max-nested-callbacks */
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDownloadableFileInfo,
  getExplorerFileVersion,
  listDirectoryEntries,
  readExplorerFile,
  writeExplorerFile,
} from "./service.js";
import { isPlatform } from "../../test-utils/platform.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe.skipIf(isPlatform("win32"))("service POSIX-only", () => {
  it("refuses to replace a read-only file through a writable parent directory", async () => {
    const root = await createTempDir("byspace-file-explorer-");

    try {
      const target = path.join(root, "read-only.txt");
      await writeFile(target, "before", "utf-8");
      const version = await getExplorerFileVersion({ root, relativePath: "read-only.txt" });
      if (version.status !== "ready") throw new Error("Expected ready file version");
      await chmod(target, 0o444);

      const result = await writeExplorerFile({
        root,
        relativePath: "read-only.txt",
        content: "after",
        expectedModifiedAt: version.modifiedAt,
        expectedRevision: version.revision,
      });

      expect(result).toEqual({ status: "error", error: "File is read-only" });
      expect((await readExplorerFile({ root, relativePath: "read-only.txt" })).content).toBe(
        "before",
      );
    } finally {
      await chmod(path.join(root, "read-only.txt"), 0o644).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists directory entries even when a dangling symlink exists", async () => {
    const root = await createTempDir("byspace-file-explorer-");

    try {
      await mkdir(path.join(root, "packages", "server"), { recursive: true });
      const serverDir = path.join(root, "packages", "server");
      await writeFile(path.join(serverDir, "README.md"), "# server\n", "utf-8");
      await symlink("CLAUDE.md", path.join(serverDir, "AGENTS.md"));

      const result = await listDirectoryEntries({
        root,
        relativePath: "packages/server",
      });

      expect(result.path).toBe("packages/server");
      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("README.md");
      expect(names).not.toContain("AGENTS.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked files that resolve outside the workspace", async () => {
    const root = await createTempDir("byspace-file-explorer-");
    const outsideRoot = await createTempDir("byspace-file-explorer-outside-");

    try {
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "secret-link.txt"));

      await expect(
        readExplorerFile({
          root,
          relativePath: "secret-link.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("skips listed symlink entries that resolve outside the workspace", async () => {
    const root = await createTempDir("byspace-file-explorer-");
    const outsideRoot = await createTempDir("byspace-file-explorer-outside-");

    try {
      await writeFile(path.join(root, "visible.txt"), "visible\n", "utf-8");
      const externalFile = path.join(outsideRoot, "secret.txt");
      await writeFile(externalFile, "top secret\n", "utf-8");
      await symlink(externalFile, path.join(root, "secret-link.txt"));

      const result = await listDirectoryEntries({ root });

      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain("visible.txt");
      expect(names).not.toContain("secret-link.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("serializes writes through canonical and symlink-alias paths", async () => {
    const root = await createTempDir("byspace-file-alias-write-");
    try {
      await mkdir(path.join(root, "real"));
      await writeFile(path.join(root, "real", "notes.txt"), "before", "utf8");
      await symlink("real", path.join(root, "alias"));
      const current = await getExplorerFileVersion({ root, relativePath: "real/notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;
      const write = (relativePath: string, content: string) =>
        writeExplorerFile({
          root,
          relativePath,
          content,
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

      const results = await Promise.all([
        write("real/notes.txt", "first"),
        write("alias/notes.txt", "second"),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(["conflict", "written"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses canonical paths for downloadable symlink targets inside the workspace", async () => {
    const root = await createTempDir("byspace-file-explorer-");

    try {
      const target = path.join(root, "safe.txt");
      const link = path.join(root, "safe-link.txt");
      await writeFile(target, "safe\n", "utf-8");
      await symlink("safe.txt", link);

      const file = await readExplorerFile({
        root,
        relativePath: "safe-link.txt",
      });
      const info = await getDownloadableFileInfo({
        root,
        relativePath: "safe-link.txt",
      });

      expect(file.path).toBe("safe-link.txt");
      expect(file.content).toBe("safe\n");
      expect(info.path).toBe("safe-link.txt");
      expect(info.fileName).toBe("safe-link.txt");
      expect(info.absolutePath).toBe(await realpath(target));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
