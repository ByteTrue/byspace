import { describe, expect, it } from "vitest";
import { normalizePickedImageAssets } from "./image-attachment-picker";

describe("image-attachment-picker", () => {
  it("normalizes a picked File into a blob source", async () => {
    const file = new File(["hello"], "picked.png", { type: "image/png" });
    const result = await normalizePickedImageAssets([
      { uri: "blob:test", mimeType: "image/png", fileName: null, file },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source.kind).toBe("blob");
    expect(result[0]?.fileName).toBe("picked.png");
  });

  it("keeps file URI results", async () => {
    const result = await normalizePickedImageAssets([
      { uri: "file:///tmp/picked.png", mimeType: "image/png", fileName: "picked.png" },
    ]);
    expect(result[0]).toEqual({
      source: { kind: "file_uri", uri: "file:///tmp/picked.png" },
      mimeType: "image/png",
      fileName: "picked.png",
    });
  });

  it("converts data URLs into blob sources", async () => {
    const result = await normalizePickedImageAssets([
      { uri: "data:image/png;base64,AAEC", mimeType: "image/png", fileName: "inline.png" },
    ]);
    expect(result[0]?.source.kind).toBe("blob");
  });
});
