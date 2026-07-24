import { constants, promises as fs, type BigIntStats } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { expandUserPath, resolvePathFromBase } from "../path-utils.js";

export type ExplorerEntryKind = "file" | "directory";
export type ExplorerFileKind = "text" | "image" | "binary";
export type ExplorerEncoding = "utf-8" | "base64" | "none";

export interface ListDirectoryParams {
  root: string;
  relativePath?: string;
}

export interface ReadFileParams {
  root: string;
  relativePath: string;
}

export interface WriteFileParams extends ReadFileParams {
  content: string;
  expectedModifiedAt: string;
  expectedRevision?: string;
}

export type ExplorerFileVersion =
  | {
      status: "ready";
      cwd: string;
      path: string;
      size: number;
      modifiedAt: string;
      revision: string;
    }
  | { status: "missing"; cwd: string; path: string }
  | { status: "error"; cwd: string; path: string; error: string };

export type ExplorerFileWriteResult =
  | { status: "written"; modifiedAt: string; size: number; revision: string }
  | { status: "conflict"; version: ExplorerFileVersion }
  | { status: "error"; error: string };

export interface FileExplorerEntry {
  name: string;
  path: string;
  kind: ExplorerEntryKind;
  size: number;
  modifiedAt: string;
}

export interface FileExplorerDirectory {
  path: string;
  entries: FileExplorerEntry[];
}

export interface FileExplorerFile {
  path: string;
  kind: ExplorerFileKind;
  encoding: ExplorerEncoding;
  content?: string;
  mimeType?: string;
  size: number;
  modifiedAt: string;
  revision: string;
}

export interface FileExplorerFileBytes {
  path: string;
  kind: ExplorerFileKind;
  encoding: "utf-8" | "binary";
  bytes: Uint8Array;
  mimeType: string;
  size: number;
  modifiedAt: string;
  revision: string;
}

const TEXT_MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
};

const DEFAULT_TEXT_MIME_TYPE = "text/plain";
const FILE_TYPE_SAMPLE_BYTES = 8192;
export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
const READ_FILE_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
const ACCESS_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace is not allowed";
const fileWriteQueues = new Map<string, Promise<void>>();

async function withFileWriteQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileWriteQueues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const barrier = result.then(
    () => undefined,
    () => undefined,
  );
  fileWriteQueues.set(key, barrier);
  try {
    return await result;
  } finally {
    if (fileWriteQueues.get(key) === barrier) fileWriteQueues.delete(key);
  }
}

function fileRevision(stats: BigIntStats, bytes?: Uint8Array): string {
  const digest = bytes ? createHash("sha256").update(bytes).digest("base64url") : "metadata";
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}:${stats.mode}:${digest}`;
}

function matchesExpectedRevision(
  stats: BigIntStats,
  expectedRevision: string,
  bytes: Uint8Array,
): boolean {
  return fileRevision(stats, bytes) === expectedRevision;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

interface ScopedPathParams {
  root: string;
  relativePath?: string;
}

interface ScopedPath {
  requestedPath: string;
  resolvedPath: string;
}

interface EntryPayloadParams {
  root: string;
  targetPath: string;
  name: string;
  kind: ExplorerEntryKind;
}

export async function listDirectoryEntries({
  root,
  relativePath = ".",
}: ListDirectoryParams): Promise<FileExplorerDirectory> {
  const directoryPath = await resolveScopedPath({ root, relativePath });
  const stats = await fs.stat(directoryPath.resolvedPath);

  if (!stats.isDirectory()) {
    throw new Error("Requested path is not a directory");
  }

  const dirents = await fs.readdir(directoryPath.resolvedPath, { withFileTypes: true });

  const entriesWithNulls = await Promise.all(
    dirents.map(async (dirent) => {
      const targetPath = path.join(directoryPath.requestedPath, dirent.name);
      const kind: ExplorerEntryKind = dirent.isDirectory() ? "directory" : "file";
      try {
        return await buildEntryPayload({
          root,
          targetPath,
          name: dirent.name,
          kind,
        });
      } catch (error) {
        // Directories can contain dangling links (e.g. AGENTS.md -> CLAUDE.md).
        // Skip entries whose targets disappeared instead of failing the whole listing.
        if (isMissingEntryError(error) || isOutsideWorkspaceError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );
  const entries = entriesWithNulls.filter((entry): entry is FileExplorerEntry => entry !== null);

  entries.sort((a, b) => {
    const modifiedComparison = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    if (modifiedComparison !== 0) {
      return modifiedComparison;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: normalizeRelativePath({ root, targetPath: directoryPath.requestedPath }),
    entries,
  };
}

export async function readExplorerFile({
  root,
  relativePath,
}: ReadFileParams): Promise<FileExplorerFile> {
  const file = await readExplorerFileBytes({ root, relativePath });

  if (file.kind === "image") {
    return {
      path: file.path,
      kind: file.kind,
      encoding: "base64",
      content: Buffer.from(file.bytes).toString("base64"),
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
      revision: file.revision,
    };
  }

  if (file.kind === "binary") {
    return {
      path: file.path,
      kind: file.kind,
      encoding: "none",
      mimeType: file.mimeType,
      size: file.size,
      modifiedAt: file.modifiedAt,
      revision: file.revision,
    };
  }

  return {
    path: file.path,
    kind: file.kind,
    encoding: "utf-8",
    content: Buffer.from(file.bytes).toString("utf-8"),
    mimeType: file.mimeType,
    size: file.size,
    modifiedAt: file.modifiedAt,
    revision: file.revision,
  };
}

export async function readExplorerFileBytes({
  root,
  relativePath,
}: ReadFileParams): Promise<FileExplorerFileBytes> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat({ bigint: true });

    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    const buffer = await handle.readFile();
    const basePayload = {
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      size: Number(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      revision: fileRevision(stats, buffer),
    };
    if (ext in IMAGE_MIME_TYPES) {
      return {
        ...basePayload,
        kind: "image",
        encoding: "binary",
        bytes: buffer,
        mimeType: IMAGE_MIME_TYPES[ext],
      };
    }

    if (isLikelyBinary(buffer) || !isValidUtf8(buffer)) {
      return {
        ...basePayload,
        kind: "binary",
        encoding: "binary",
        bytes: buffer,
        mimeType: "application/octet-stream",
      };
    }

    return {
      ...basePayload,
      kind: "text",
      encoding: "utf-8",
      bytes: buffer,
      mimeType: textMimeTypeForExtension(ext),
    };
  } finally {
    await handle.close();
  }
}

export async function getExplorerFileVersion({
  root,
  relativePath,
}: ReadFileParams): Promise<ExplorerFileVersion> {
  const cwd = expandUserPath(root);
  try {
    const filePath = await resolveScopedPath({ root, relativePath });
    const handle = await openFileForRead(filePath.resolvedPath);
    try {
      const stats = await handle.stat({ bigint: true });
      if (!stats.isFile()) {
        return { status: "error", cwd, path: relativePath, error: "Requested path is not a file" };
      }
      const bytes =
        stats.size <= BigInt(MAX_EDITABLE_FILE_BYTES) ? await handle.readFile() : undefined;
      return {
        status: "ready",
        cwd,
        path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
        size: Number(stats.size),
        modifiedAt: stats.mtime.toISOString(),
        revision: fileRevision(stats, bytes),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "missing", cwd, path: relativePath };
    }
    return {
      status: "error",
      cwd,
      path: relativePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveExplorerFilePath({
  root,
  relativePath,
}: ReadFileParams): Promise<string> {
  return (await resolveScopedPath({ root, relativePath })).resolvedPath;
}

interface WritableFileSnapshot {
  stats: BigIntStats;
  bytes: Buffer;
  mode: number;
}

async function readWritableFileSnapshot(
  resolvedPath: string,
): Promise<WritableFileSnapshot | { error: string }> {
  const handle = await openFileForRead(resolvedPath);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) return { error: "Requested path is not a file" };
    if (stats.size > BigInt(MAX_EDITABLE_FILE_BYTES)) {
      return { error: "File is too large to edit" };
    }
    const bytes = await handle.readFile();
    if (isLikelyBinary(bytes) || !isValidUtf8(bytes)) {
      return { error: "Binary files cannot be edited" };
    }
    const mode = Number(stats.mode);
    if (process.platform !== "win32" && (mode & 0o222) === 0) {
      return { error: "File is read-only" };
    }
    try {
      await fs.access(resolvedPath, constants.W_OK);
    } catch {
      return { error: "File is read-only" };
    }
    return { stats, bytes, mode };
  } finally {
    await handle.close();
  }
}

export async function writeExplorerFile(input: WriteFileParams): Promise<ExplorerFileWriteResult> {
  let queueKey = path.resolve(expandUserPath(input.root), input.relativePath);
  try {
    queueKey = (await resolveScopedPath(input)).resolvedPath;
  } catch {
    // Let the write path return the precise missing/out-of-scope result.
  }
  return withFileWriteQueue(queueKey, () => writeExplorerFileUnlocked(input));
}

async function writeExplorerFileUnlocked({
  root,
  relativePath,
  content,
  expectedRevision,
}: WriteFileParams): Promise<ExplorerFileWriteResult> {
  const encoded = Buffer.from(content, "utf8");
  if (encoded.byteLength > MAX_EDITABLE_FILE_BYTES) {
    return { status: "error", error: "File is too large to edit" };
  }

  let filePath: ScopedPath;
  let currentMode = 0o600;
  try {
    filePath = await resolveScopedPath({ root, relativePath });
    const current = await readWritableFileSnapshot(filePath.resolvedPath);
    if ("error" in current) return { status: "error", error: current.error };
    currentMode = current.mode;
    if (!expectedRevision) {
      return {
        status: "error",
        error: "A precise file revision is required; reload and try again",
      };
    }
    if (!matchesExpectedRevision(current.stats, expectedRevision, current.bytes)) {
      return {
        status: "conflict",
        version: {
          status: "ready",
          cwd: expandUserPath(root),
          path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
          size: Number(current.stats.size),
          modifiedAt: current.stats.mtime.toISOString(),
          revision: fileRevision(current.stats, current.bytes),
        },
      };
    }
  } catch (error) {
    if (isMissingEntryError(error)) {
      return {
        status: "conflict",
        version: { status: "missing", cwd: expandUserPath(root), path: relativePath },
      };
    }
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }

  const temporaryPath = path.join(
    path.dirname(filePath.resolvedPath),
    `.${path.basename(filePath.resolvedPath)}.byspace-${randomUUID()}.tmp`,
  );
  let temporaryHandle: FileHandle | null = null;
  try {
    temporaryHandle = await fs.open(temporaryPath, "wx", currentMode);
    if (process.platform !== "win32") {
      await temporaryHandle.chmod(currentMode & 0o7777);
    }
    await temporaryHandle.writeFile(encoded);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    const revalidatedPath = await resolveScopedPath({ root, relativePath });
    if (revalidatedPath.resolvedPath !== filePath.resolvedPath) {
      return { status: "error", error: "File path changed while saving" };
    }
    const latest = await readWritableFileSnapshot(filePath.resolvedPath);
    if ("error" in latest) {
      return {
        status: "error",
        error:
          latest.error === "File is read-only"
            ? "File became read-only while saving"
            : latest.error,
      };
    }
    if (!matchesExpectedRevision(latest.stats, expectedRevision, latest.bytes)) {
      return {
        status: "conflict",
        version: {
          status: "ready",
          cwd: expandUserPath(root),
          path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
          size: Number(latest.stats.size),
          modifiedAt: latest.stats.mtime.toISOString(),
          revision: fileRevision(latest.stats, latest.bytes),
        },
      };
    }
    await fs.rename(temporaryPath, filePath.resolvedPath);
    const stats = await fs.stat(filePath.resolvedPath, { bigint: true });
    return {
      status: "written",
      modifiedAt: stats.mtime.toISOString(),
      size: Number(stats.size),
      revision: fileRevision(stats, encoded),
    };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function getDownloadableFileInfo({ root, relativePath }: ReadFileParams): Promise<{
  path: string;
  absolutePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}> {
  const filePath = await resolveScopedPath({ root, relativePath });
  const handle = await openFileForRead(filePath.resolvedPath);

  try {
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    const ext = path.extname(filePath.resolvedPath).toLowerCase();
    let mimeType = "application/octet-stream";
    if (ext in IMAGE_MIME_TYPES) {
      mimeType = IMAGE_MIME_TYPES[ext];
    } else {
      const sample = Buffer.alloc(FILE_TYPE_SAMPLE_BYTES);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const chunk = bytesRead < sample.length ? sample.subarray(0, bytesRead) : sample;
      if (!isLikelyBinary(chunk)) {
        mimeType = textMimeTypeForExtension(ext);
      }
    }

    return {
      path: normalizeRelativePath({ root, targetPath: filePath.requestedPath }),
      absolutePath: filePath.resolvedPath,
      fileName: path.basename(filePath.requestedPath),
      mimeType,
      size: stats.size,
    };
  } finally {
    await handle.close();
  }
}

async function resolveScopedPath({
  root,
  relativePath = ".",
}: ScopedPathParams): Promise<ScopedPath> {
  const normalizedRoot = expandUserPath(root);
  const requestedPath = resolvePathFromBase(normalizedRoot, relativePath);
  const relative = path.relative(normalizedRoot, requestedPath);

  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
  }

  const realRoot = await fs.realpath(normalizedRoot);

  try {
    const realPath = await fs.realpath(requestedPath);
    const realRelative = path.relative(realRoot, realPath);
    if (realRelative !== "" && (realRelative.startsWith("..") || path.isAbsolute(realRelative))) {
      throw new Error(ACCESS_OUTSIDE_WORKSPACE_MESSAGE);
    }
    return { requestedPath, resolvedPath: realPath };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { requestedPath, resolvedPath: requestedPath };
    }
    throw error;
  }
}

async function openFileForRead(filePath: string): Promise<FileHandle> {
  return fs.open(filePath, READ_FILE_OPEN_FLAGS);
}

async function buildEntryPayload({
  root,
  targetPath,
  name,
  kind,
}: EntryPayloadParams): Promise<FileExplorerEntry> {
  const entryPath = await resolveScopedPath({
    root,
    relativePath: normalizeRelativePath({ root, targetPath }),
  });
  const stats = await fs.stat(entryPath.resolvedPath);
  return {
    name,
    path: normalizeRelativePath({ root, targetPath }),
    kind,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

function isMissingEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

function isOutsideWorkspaceError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCESS_OUTSIDE_WORKSPACE_MESSAGE;
}

function normalizeRelativePath({ root, targetPath }: { root: string; targetPath: string }): string {
  const normalizedRoot = expandUserPath(root);
  const normalizedTarget = expandUserPath(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

function textMimeTypeForExtension(ext: string): string {
  return TEXT_MIME_TYPES[ext] ?? DEFAULT_TEXT_MIME_TYPE;
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;
  for (let idx = 0; idx < buffer.length; idx += 1) {
    const byte = buffer[idx];
    if (byte === 0) {
      return true;
    }

    const isControl =
      byte < 32 &&
      byte !== 9 && // tab
      byte !== 10 && // newline
      byte !== 13; // carriage return

    if (isControl || byte === 127) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length > 0.3;
}

function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}
