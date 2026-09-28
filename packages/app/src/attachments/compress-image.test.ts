import { describe, expect, it } from "vitest";
import { compressImageBlob, shouldCompressImage } from "./compress-image";

const MIB = 1024 * 1024;

describe("shouldCompressImage", () => {
  it("compresses large jpeg and png attachments", () => {
    expect(shouldCompressImage("image/jpeg", 5 * MIB)).toBe(true);
    expect(shouldCompressImage("image/png", 12 * MIB)).toBe(true);
  });

  it("skips images at or under the size trigger", () => {
    expect(shouldCompressImage("image/png", MIB)).toBe(false);
    expect(shouldCompressImage("image/jpeg", 999_999)).toBe(false);
  });

  it("skips formats that must not be re-encoded", () => {
    expect(shouldCompressImage("image/gif", 10 * MIB)).toBe(false);
    expect(shouldCompressImage("image/svg+xml", 10 * MIB)).toBe(false);
    expect(shouldCompressImage("image/webp", 10 * MIB)).toBe(false);
  });

  it("skips images of unknown size only for non-compressible types", () => {
    expect(shouldCompressImage("image/png", null)).toBe(true);
    expect(shouldCompressImage("image/gif", null)).toBe(false);
  });
});

describe("compressImageBlob", () => {
  it("returns null for attachments that should not be compressed", async () => {
    const blob = new Blob(["x".repeat(2 * MIB)], { type: "image/gif" });
    await expect(compressImageBlob({ blob, mimeType: "image/gif" })).resolves.toBeNull();
  });

  it("returns null when the runtime has no image decoder", async () => {
    const blob = new Blob(["x".repeat(2 * MIB)], { type: "image/png" });
    await expect(compressImageBlob({ blob, mimeType: "image/png" })).resolves.toBeNull();
  });
});
