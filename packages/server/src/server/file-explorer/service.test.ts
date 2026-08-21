import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGitCommand } from "../../utils/run-git-command.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getExplorerFileVersion,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "./service.js";

async function createHomeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.homedir(), prefix));
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("file explorer service", () => {
  it("atomically writes an existing text file at the expected revision", async () => {
    const root = await createTempDir("byspace-file-write-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "before", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "after",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: current.revision,
      });

      expect(result.status).toBe("written");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("after");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent daemon writes so only one accepted revision wins", async () => {
    const root = await createTempDir("byspace-file-write-race-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "before", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;
      const write = (content: string) =>
        writeExplorerFile({
          root,
          relativePath: "notes.txt",
          content,
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

      const results = await Promise.all([write("first"), write("second")]);

      expect(results.map((result) => result.status).sort()).toEqual(["conflict", "written"]);
      expect(["first", "second"]).toContain(
        (await readExplorerFile({ root, relativePath: "notes.txt" })).content,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves the original file permissions across atomic replacement",
    async () => {
      const root = await createTempDir("byspace-file-mode-");
      try {
        const filePath = path.join(root, "script.sh");
        await writeFile(filePath, "before", "utf8");
        await chmod(filePath, 0o764);
        const current = await getExplorerFileVersion({ root, relativePath: "script.sh" });
        expect(current.status).toBe("ready");
        if (current.status !== "ready") return;

        const result = await writeExplorerFile({
          root,
          relativePath: "script.sh",
          content: "after",
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

        expect(result.status).toBe("written");
        expect((await stat(filePath)).mode & 0o7777).toBe(0o764);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects replacing a multiply-linked file instead of silently breaking its other name",
    async () => {
      const root = await createTempDir("byspace-file-hardlink-");
      try {
        const filePath = path.join(root, "notes.txt");
        const aliasPath = path.join(root, "alias.txt");
        await writeFile(filePath, "before", "utf8");
        await link(filePath, aliasPath);
        const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
        expect(current.status).toBe("ready");
        if (current.status !== "ready") return;

        const result = await writeExplorerFile({
          root,
          relativePath: "notes.txt",
          content: "after",
          expectedModifiedAt: current.modifiedAt,
          expectedRevision: current.revision,
        });

        expect(result).toEqual({
          status: "error",
          error: "Files with multiple hard links cannot be edited safely",
        });
        expect(await readFile(filePath, "utf8")).toBe("before");
        expect(await readFile(aliasPath, "utf8")).toBe("before");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects an existing-file write without a precise revision", async () => {
    const root = await createTempDir("byspace-file-revision-required-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "newer on disk", "utf8");

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({ status: "error" });
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe(
        "newer on disk",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects same-size content changes even when mtime is restored", async () => {
    const root = await createTempDir("byspace-file-content-revision-");
    try {
      const filePath = path.join(root, "notes.txt");
      const timestamp = new Date("2025-01-01T00:00:00.000Z");
      await writeFile(filePath, "AAAA", "utf8");
      await utimes(filePath, timestamp, timestamp);
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      await writeFile(filePath, "BBBB", "utf8");
      await utimes(filePath, timestamp, timestamp);
      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "CCCC",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: current.revision,
      });

      expect(result.status).toBe("conflict");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("BBBB");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the high-precision revision token over the display timestamp", async () => {
    const root = await createTempDir("byspace-file-revision-");
    try {
      const filePath = path.join(root, "notes.txt");
      await writeFile(filePath, "on disk", "utf8");
      const current = await getExplorerFileVersion({ root, relativePath: "notes.txt" });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") return;

      const result = await writeExplorerFile({
        root,
        relativePath: "notes.txt",
        content: "stale local edit",
        expectedModifiedAt: current.modifiedAt,
        expectedRevision: `${current.revision}-stale`,
      });

      expect(result.status).toBe("conflict");
      expect((await readExplorerFile({ root, relativePath: "notes.txt" })).content).toBe("on disk");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never creates a missing file through the write API", async () => {
    const root = await createTempDir("byspace-file-missing-");
    try {
      const result = await writeExplorerFile({
        root,
        relativePath: "missing.txt",
        content: "new file",
        expectedModifiedAt: "2020-01-01T00:00:00.000Z",
      });

      expect(result).toMatchObject({ status: "conflict", version: { status: "missing" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads .ex files as text", async () => {
    const root = await createTempDir("byspace-file-explorer-");

    try {
      const filePath = path.join(root, "sample.ex");
      const content = "defmodule Sample do\nend\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "sample.ex",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads unknown extension text files as text", async () => {
    const root = await createTempDir("byspace-file-explorer-");

    try {
      const filePath = path.join(root, "notes.customext");
      const content = "hello from a custom text file\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "notes.customext",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies files with null bytes as binary", async () => {
    const root = await createTempDir("byspace-file-explorer-");

    try {
      const filePath = path.join(root, "blob.weird");
      await writeFile(filePath, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

      const result = await readExplorerFile({
        root,
        relativePath: "blob.weird",
      });

      expect(result.kind).toBe("binary");
      expect(result.encoding).toBe("none");
      expect(result.content).toBeUndefined();
      expect(result.mimeType).toBe("application/octet-stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the same content-sensitive revision as editable file reads", async () => {
    const root = await createTempDir("byspace-file-stream-revision-");

    try {
      await writeFile(path.join(root, "editable.txt"), "content-sensitive\n");
      const version = await getExplorerFileVersion({ root, relativePath: "editable.txt" });
      let streamedRevision: string | undefined;

      await streamExplorerFile({ root, relativePath: "editable.txt" }, async (file) => {
        streamedRevision = file.revision;
        for await (const _chunk of file.chunks) {
          // Consume the stream so its final metadata and digest check also runs.
        }
      });

      expect(version.status).toBe("ready");
      if (version.status !== "ready") throw new Error("Expected a ready file version");
      expect(streamedRevision).toBe(version.revision);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file grows after its revision is advertised", async () => {
    const root = await createTempDir("byspace-file-stream-growth-");

    try {
      const filePath = path.join(root, "growing.log");
      const initial = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(filePath, initial);
      await expect(
        streamExplorerFile({ root, relativePath: "growing.log" }, async (file) => {
          await appendFile(filePath, Buffer.alloc(300 * 1024, 0x62));
          for await (const _chunk of file.chunks) {
            // Consume through the advertised prefix before validating the revision.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file shrinks below its advertised size", async () => {
    const root = await createTempDir("byspace-file-stream-truncate-");

    try {
      const filePath = path.join(root, "shrinking.log");
      await writeFile(filePath, Buffer.alloc(300 * 1024, 0x61));

      await expect(
        streamExplorerFile({ root, relativePath: "shrinking.log" }, async (file) => {
          await truncate(filePath, 100 * 1024);
          for await (const _chunk of file.chunks) {
            // Consume until the stream detects the premature EOF.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file is overwritten in place", async () => {
    const root = await createTempDir("byspace-file-stream-overwrite-");

    try {
      const filePath = path.join(root, "changing.log");
      const initial = Buffer.alloc(600 * 1024, 0x61);
      await writeFile(filePath, initial);

      await expect(
        streamExplorerFile({ root, relativePath: "changing.log" }, async (file) => {
          let chunkIndex = 0;
          for await (const _chunk of file.chunks) {
            chunkIndex += 1;
            if (chunkIndex === 1) {
              const replacement = Buffer.alloc(initial.byteLength, 0x62);
              await writeFile(filePath, replacement);
            }
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies sampled text when UTF-8 crosses the sample boundary", async () => {
    const root = await createTempDir("byspace-file-stream-utf8-");

    try {
      const content = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("€"), Buffer.from("z")]);
      await writeFile(path.join(root, "sample.txt"), content);
      let kind: string | undefined;
      let encoding: string | undefined;

      await streamExplorerFile({ root, relativePath: "sample.txt" }, async (file) => {
        kind = file.kind;
        encoding = file.encoding;
      });

      expect(kind).toBe("text");
      expect(encoding).toBe("utf-8");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects incomplete UTF-8 when the whole file was sampled", async () => {
    const root = await createTempDir("byspace-file-stream-invalid-utf8-");

    try {
      await writeFile(path.join(root, "invalid.txt"), Buffer.from([0x61, 0xe2, 0x82]));
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "invalid.txt" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects binary bytes beyond the initial classification block", async () => {
    const root = await createTempDir("byspace-file-stream-late-binary-");

    try {
      const content = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0xff])]);
      await writeFile(path.join(root, "late-binary.unknown"), content);
      let kind: string | undefined;

      await streamExplorerFile({ root, relativePath: "late-binary.unknown" }, async (file) => {
        kind = file.kind;
      });

      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("expands a ~ prefix in relative paths against the user home directory", async () => {
    const root = await createHomeTempDir(".byspace-file-explorer-home-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root,
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.content).toBe("hello from home\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows home to be the scoped root for tilde file previews", async () => {
    const root = await createHomeTempDir(".byspace-file-explorer-home-root-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home root\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root: "~",
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.path).toBe(path.relative(os.homedir(), filePath).split(path.sep).join("/"));
      expect(result.content).toBe("hello from home root\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ~-prefixed paths that resolve outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "byspace-file-explorer-outside-home-"));

    try {
      await expect(
        readExplorerFile({
          root,
          relativePath: "~/some/file.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("creates files and directories, refusing duplicates and separator names", async () => {
    const root = await createTempDir("byspace-entry-create-");
    try {
      const file = await createExplorerEntry({
        root,
        parentPath: ".",
        name: "notes.txt",
        kind: "file",
      });
      expect(file).toEqual({ status: "ok", path: "notes.txt" });
      expect((await stat(path.join(root, "notes.txt"))).isFile()).toBe(true);

      const dir = await createExplorerEntry({
        root,
        parentPath: ".",
        name: "docs",
        kind: "directory",
      });
      expect(dir).toEqual({ status: "ok", path: "docs" });
      const nested = await createExplorerEntry({
        root,
        parentPath: "docs",
        name: "guide.md",
        kind: "file",
      });
      expect(nested).toEqual({ status: "ok", path: "docs/guide.md" });

      const duplicate = await createExplorerEntry({
        root,
        parentPath: ".",
        name: "notes.txt",
        kind: "file",
      });
      expect(duplicate.status).toBe("error");

      const traversal = await createExplorerEntry({
        root,
        parentPath: ".",
        name: "../escape",
        kind: "directory",
      });
      expect(traversal.status).toBe("error");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("duplicates files and folders with collision-free sibling names", async () => {
    const root = await createTempDir("byspace-entry-duplicate-");
    try {
      await writeFile(path.join(root, "notes.txt"), "original", "utf8");
      const firstFileCopy = await duplicateExplorerEntry({
        root,
        relativePath: "notes.txt",
      });
      expect(firstFileCopy).toEqual({ status: "ok", path: "notes copy.txt" });
      expect(await readFile(path.join(root, "notes copy.txt"), "utf8")).toBe("original");

      const secondFileCopy = await duplicateExplorerEntry({
        root,
        relativePath: "notes.txt",
      });
      expect(secondFileCopy).toEqual({ status: "ok", path: "notes copy 2.txt" });

      await mkdir(path.join(root, "docs"));
      await writeFile(path.join(root, "docs", "guide.md"), "guide", "utf8");
      const folderCopy = await duplicateExplorerEntry({ root, relativePath: "docs" });
      expect(folderCopy).toEqual({ status: "ok", path: "docs copy" });
      expect(await readFile(path.join(root, "docs copy", "guide.md"), "utf8")).toBe("guide");

      await expect(duplicateExplorerEntry({ root, relativePath: "." })).resolves.toMatchObject({
        status: "error",
      });
      await expect(duplicateExplorerEntry({ root, relativePath: "missing.txt" })).resolves.toEqual({
        status: "error",
        error: "File or folder no longer exists",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renames tracked entries with Git and untracked entries on the filesystem", async () => {
    const root = await createTempDir("byspace-entry-rename-");
    try {
      await runGitCommand(["init"], { cwd: root });
      await writeFile(path.join(root, "tracked.txt"), "tracked", "utf8");
      await mkdir(path.join(root, "tracked-folder"));
      await writeFile(path.join(root, "tracked-folder", "inside.txt"), "tracked", "utf8");
      await runGitCommand(["add", "."], { cwd: root });
      await runGitCommand(
        [
          "-c",
          "user.name=BySpace Test",
          "-c",
          "user.email=test@byspace.local",
          "commit",
          "-m",
          "base",
        ],
        { cwd: root },
      );

      const tracked = await renameExplorerEntry({
        root,
        relativePath: "tracked.txt",
        name: "renamed.txt",
      });
      expect(tracked).toEqual({ status: "ok", path: "renamed.txt" });
      expect((await runGitCommand(["status", "--short"], { cwd: root })).stdout.trim()).toBe(
        "R  tracked.txt -> renamed.txt",
      );

      const trackedFolder = await renameExplorerEntry({
        root,
        relativePath: "tracked-folder",
        name: "renamed-folder",
      });
      expect(trackedFolder).toEqual({ status: "ok", path: "renamed-folder" });
      const gitStatus = (await runGitCommand(["status", "--short"], { cwd: root })).stdout;
      expect(gitStatus).toContain("tracked-folder/inside.txt -> renamed-folder/inside.txt");

      await writeFile(path.join(root, "untracked.txt"), "untracked", "utf8");
      const untracked = await renameExplorerEntry({
        root,
        relativePath: "untracked.txt",
        name: "moved.txt",
      });
      expect(untracked).toEqual({ status: "ok", path: "moved.txt" });
      expect((await stat(path.join(root, "moved.txt"))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports case-only renames for tracked and untracked files", async () => {
    const root = await createTempDir("byspace-entry-case-rename-");
    try {
      await runGitCommand(["init"], { cwd: root });
      await writeFile(path.join(root, "Tracked.txt"), "tracked", "utf8");
      await writeFile(path.join(root, "Loose.txt"), "untracked", "utf8");
      await runGitCommand(["add", "Tracked.txt"], { cwd: root });
      await runGitCommand(
        [
          "-c",
          "user.name=BySpace Test",
          "-c",
          "user.email=test@byspace.local",
          "commit",
          "-m",
          "base",
        ],
        { cwd: root },
      );

      await expect(
        renameExplorerEntry({ root, relativePath: "Tracked.txt", name: "tracked.txt" }),
      ).resolves.toEqual({ status: "ok", path: "tracked.txt" });
      expect((await stat(path.join(root, "tracked.txt"))).isFile()).toBe(true);

      await expect(
        renameExplorerEntry({ root, relativePath: "Loose.txt", name: "loose.txt" }),
      ).resolves.toEqual({ status: "ok", path: "loose.txt" });
      expect((await stat(path.join(root, "loose.txt"))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses invalid renames, existing targets, and the workspace root", async () => {
    const root = await createTempDir("byspace-entry-rename-errors-");
    try {
      await writeFile(path.join(root, "source.txt"), "source", "utf8");
      await writeFile(path.join(root, "existing.txt"), "existing", "utf8");

      await expect(
        renameExplorerEntry({ root, relativePath: "source.txt", name: "existing.txt" }),
      ).resolves.toEqual({ status: "error", error: '"existing.txt" already exists' });
      await expect(
        renameExplorerEntry({ root, relativePath: "source.txt", name: "../outside.txt" }),
      ).resolves.toEqual({ status: "error", error: "Name cannot contain path separators" });
      await expect(
        renameExplorerEntry({ root, relativePath: ".", name: "renamed-root" }),
      ).resolves.toEqual({ status: "error", error: "Cannot rename the workspace root" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes files and directories but never the workspace root or outside paths", async () => {
    const root = await createTempDir("byspace-entry-delete-");
    try {
      await writeFile(path.join(root, "doomed.txt"), "bye", "utf8");
      const removedFile = await deleteExplorerEntry({ root, relativePath: "doomed.txt" });
      expect(removedFile).toEqual({ status: "ok", path: "doomed.txt" });
      await expect(stat(path.join(root, "doomed.txt"))).rejects.toThrow();

      await createExplorerEntry({ root, parentPath: ".", name: "nested", kind: "directory" });
      await writeFile(path.join(root, "nested", "inner.txt"), "hi", "utf8");
      const removedDir = await deleteExplorerEntry({ root, relativePath: "nested" });
      expect(removedDir).toEqual({ status: "ok", path: "nested" });
      await expect(stat(path.join(root, "nested"))).rejects.toThrow();

      const rootDelete = await deleteExplorerEntry({ root, relativePath: "." });
      expect(rootDelete.status).toBe("error");

      await expect(
        deleteExplorerEntry({ root, relativePath: "../outside" }),
      ).resolves.toMatchObject({ status: "error" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
