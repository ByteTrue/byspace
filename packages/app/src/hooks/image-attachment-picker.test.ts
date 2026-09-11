import { describe, expect, it } from "vitest";
import { normalizePickedImageAssets } from "./image-attachment-picker";

describe("image-attachment-picker", () => {
  it("normalizes a picked File into a blob source", async () => {
    const file = new File(["hello"], "picked.png", { type: "image/png" });

    const result = await normalizePickedImageAssets([
      {
        uri: "blob:test",
        mimeType: "image/png",
        fileName: null,
        file,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.source.kind).toBe("blob");
    expect(result[0]?.fileName).toBe("picked.png");
    expect(result[0]?.mimeType).toBe("image/png");
  });

  it("derives the type of a type-less picked File from its name", async () => {
    const file = new File(["image"], "picked.png");

    const result = await normalizePickedImageAssets([
      {
        uri: "blob:test",
        mimeType: null,
        fileName: null,
        file,
      },
    ]);

    expect(result).toEqual([
      {
        source: { kind: "blob", blob: file },
        mimeType: "image/png",
        fileName: "picked.png",
      },
    ]);
  });

  it("keeps filesystem picker results as file uris", async () => {
    const result = await normalizePickedImageAssets([
      {
        uri: "file:///tmp/picked.png",
        mimeType: "image/png",
        fileName: "picked.png",
      },
    ]);

    expect(result).toEqual([
      {
        source: { kind: "file_uri", uri: "file:///tmp/picked.png" },
        mimeType: "image/png",
        fileName: "picked.png",
      },
    ]);
  });

  it("converts data urls into blob sources when no file path exists", async () => {
    const result = await normalizePickedImageAssets([
      {
        uri: "data:image/png;base64,AAEC",
        mimeType: "image/png",
        fileName: "inline.png",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.source.kind).toBe("blob");
    expect(result[0]?.fileName).toBe("inline.png");
    expect(result[0]?.mimeType).toBe("image/png");
  });
});
