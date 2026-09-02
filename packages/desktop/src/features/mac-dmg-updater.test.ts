import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAndOpenMacDmg, type MacDmgUpdateInfo } from "./mac-dmg-updater";

const temporaryDirectories: string[] = [];

async function createDownloadsDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "byspace-dmg-update-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha512(content: string): string {
  return createHash("sha512").update(content).digest("base64");
}

function updateInfo(content: string): MacDmgUpdateInfo {
  return {
    version: "1.2.3",
    files: [
      { url: "BySpace-1.2.3-x64.zip", sha512: "zip" },
      { url: "BySpace-1.2.3-arm64.dmg", sha512: sha512("arm") },
      { url: "BySpace-1.2.3-x64.dmg", sha512: sha512(content) },
    ],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("downloadAndOpenMacDmg", () => {
  it("downloads, verifies, strips quarantine, and opens the DMG for the current architecture", async () => {
    const downloadsDirectory = await createDownloadsDirectory();
    const openPath = vi.fn(async () => "");
    const stripQuarantine = vi.fn(async () => {});
    const fetch = vi.fn(async () => new Response("intel"));

    const filePath = await downloadAndOpenMacDmg(updateInfo("intel"), {
      arch: "x64",
      downloadsDirectory,
      fetch,
      openPath,
      stripQuarantine,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://github.com/ByteTrue/byspace/releases/download/v1.2.3/BySpace-1.2.3-x64.dmg",
    );
    expect(filePath).toBe(path.join(downloadsDirectory, "BySpace-1.2.3-x64.dmg"));
    expect(await readFile(filePath, "utf8")).toBe("intel");
    expect(stripQuarantine).toHaveBeenCalledWith(filePath);
    expect(openPath).toHaveBeenCalledWith(filePath);
  });

  it("proceeds to open DMG even if stripQuarantine fails", async () => {
    const downloadsDirectory = await createDownloadsDirectory();
    const openPath = vi.fn(async () => "");
    const stripQuarantine = vi.fn(async () => {
      throw new Error("xattr failed");
    });
    const fetch = vi.fn(async () => new Response("intel"));

    const filePath = await downloadAndOpenMacDmg(updateInfo("intel"), {
      arch: "x64",
      downloadsDirectory,
      fetch,
      openPath,
      stripQuarantine,
    });

    expect(stripQuarantine).toHaveBeenCalledWith(filePath);
    expect(openPath).toHaveBeenCalledWith(filePath);
    expect(filePath).toBe(path.join(downloadsDirectory, "BySpace-1.2.3-x64.dmg"));
  });

  it("keeps encoded manifest paths inside Downloads", async () => {
    const downloadsDirectory = await createDownloadsDirectory();
    const content = "safe";

    const filePath = await downloadAndOpenMacDmg(
      {
        version: "1.2.3",
        files: [
          {
            url: "nested%2FBySpace-1.2.3-arm64.dmg",
            sha512: sha512(content),
          },
        ],
      },
      {
        arch: "arm64",
        downloadsDirectory,
        fetch: async () => new Response(content),
        openPath: async () => "",
      },
    );

    expect(filePath).toBe(path.join(downloadsDirectory, "BySpace-1.2.3-arm64.dmg"));
  });

  it("removes an invalid download and does not open it", async () => {
    const downloadsDirectory = await createDownloadsDirectory();
    const openPath = vi.fn(async () => "");

    await expect(
      downloadAndOpenMacDmg(updateInfo("expected"), {
        arch: "x64",
        downloadsDirectory,
        fetch: async () => new Response("tampered"),
        openPath,
      }),
    ).rejects.toThrow("DMG checksum verification failed");

    expect(openPath).not.toHaveBeenCalled();
    await expect(
      readFile(path.join(downloadsDirectory, "BySpace-1.2.3-x64.dmg.download")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the verified DMG when Finder cannot open it", async () => {
    const downloadsDirectory = await createDownloadsDirectory();
    const filePath = path.join(downloadsDirectory, "BySpace-1.2.3-arm64.dmg");

    await expect(
      downloadAndOpenMacDmg(updateInfo("intel"), {
        arch: "arm64",
        downloadsDirectory,
        fetch: async () => new Response("arm"),
        openPath: async () => "Launch Services rejected the image",
      }),
    ).rejects.toThrow("DMG downloaded but could not be opened");

    expect(await readFile(filePath, "utf8")).toBe("arm");
  });

  it("rejects releases without a DMG for the current architecture", async () => {
    const downloadsDirectory = await createDownloadsDirectory();

    await expect(
      downloadAndOpenMacDmg(
        {
          version: "1.2.3",
          files: [{ url: "BySpace-1.2.3-arm64.dmg", sha512: sha512("arm") }],
        },
        {
          arch: "x64",
          downloadsDirectory,
          fetch: async () => new Response("unused"),
          openPath: async () => "",
        },
      ),
    ).rejects.toThrow("No x64 DMG was published");
  });
});
