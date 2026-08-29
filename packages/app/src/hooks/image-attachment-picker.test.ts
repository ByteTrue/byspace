import { describe, expect, it } from "vitest";
import { normalizePickedImageFiles } from "./image-attachment-picker";

describe("normalizePickedImageFiles", () => {
  it("preserves a supported image MIME type", () => {
    const file = new File(["image"], "photo.png", { type: "image/png" });

    expect(normalizePickedImageFiles([file])).toEqual([
      {
        source: { kind: "blob", blob: file },
        mimeType: "image/png",
        fileName: "photo.png",
      },
    ]);
  });

  it("rejects unsupported and mismatched image types", () => {
    expect(() =>
      normalizePickedImageFiles([new File(["text"], "not-an-image.png", { type: "text/plain" })]),
    ).toThrow("Unsupported image type");
  });
});
