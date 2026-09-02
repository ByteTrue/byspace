import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

interface MacDmgFile {
  url: string;
  sha512?: string;
}

export interface MacDmgUpdateInfo {
  version: string;
  files?: readonly MacDmgFile[];
}

export interface MacDmgInstallerDeps {
  arch: string;
  downloadsDirectory: string;
  fetch(url: string): Promise<Response>;
  openPath(filePath: string): Promise<string>;
  stripQuarantine?(filePath: string): Promise<void>;
}

const RELEASE_DOWNLOAD_BASE = "https://github.com/ByteTrue/byspace/releases/download/";

export async function downloadAndOpenMacDmg(
  info: MacDmgUpdateInfo,
  deps: MacDmgInstallerDeps,
): Promise<string> {
  const file = selectMacDmgFile(info, deps.arch);
  const downloadUrl = resolveDownloadUrl(info.version, file.url);
  const decodedDownloadPath = decodeURIComponent(new URL(downloadUrl).pathname);
  const fileName = path.posix.basename(decodedDownloadPath);
  const destinationPath = path.join(deps.downloadsDirectory, fileName);
  const temporaryPath = `${destinationPath}.download`;

  await rm(temporaryPath, { force: true });
  try {
    const response = await deps.fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`DMG download failed with HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error("DMG download returned an empty response body");
    }

    const digest = createHash("sha512");
    const hashStream = new Transform({
      transform(chunk, _encoding, callback) {
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      hashStream,
      createWriteStream(temporaryPath),
    );

    const actualSha512 = digest.digest("base64");
    if (actualSha512 !== file.sha512) {
      throw new Error("DMG checksum verification failed");
    }

    await rm(destinationPath, { force: true });
    await rename(temporaryPath, destinationPath);

    if (deps.stripQuarantine) {
      try {
        await deps.stripQuarantine(destinationPath);
      } catch {
        // Quarantine clearing is best-effort and must not fail valid downloads
      }
    }

    const openError = await deps.openPath(destinationPath);
    if (openError) {
      throw new Error(`DMG downloaded but could not be opened: ${openError}`);
    }
    return destinationPath;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function selectMacDmgFile(info: MacDmgUpdateInfo, arch: string): MacDmgFile & { sha512: string } {
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`Unsupported macOS update architecture: ${arch}`);
  }

  const expectedSuffix = `-${arch}.dmg`;
  const file = info.files?.find((candidate) => {
    const pathname = candidate.url.startsWith("https://")
      ? new URL(candidate.url).pathname
      : candidate.url.split("?", 1)[0];
    return decodeURIComponent(pathname).endsWith(expectedSuffix);
  });
  if (!file) {
    throw new Error(`No ${arch} DMG was published for BySpace ${info.version}`);
  }
  if (!file.sha512) {
    throw new Error(`The ${arch} DMG is missing its SHA-512 checksum`);
  }
  return { ...file, sha512: file.sha512 };
}

function resolveDownloadUrl(version: string, fileUrl: string): string {
  if (fileUrl.startsWith("https://")) {
    return fileUrl;
  }
  return new URL(fileUrl, `${RELEASE_DOWNLOAD_BASE}v${encodeURIComponent(version)}/`).toString();
}
