/**
 * Send-time image compression for composer attachments.
 *
 * Full-size originals (4K screenshots) inlined as base64 blow through the
 * relay's 32 MiB frame limit (~24 MiB plaintext budget after E2EE base64
 * expansion). Downscale to a model-friendly long edge and re-encode as JPEG
 * before the bytes hit the wire. Originals stay untouched in the attachment
 * store, so previews keep full quality.
 */

const COMPRESSION_TRIGGER_BYTES = 1024 * 1024; // 1 MiB
const MAX_LONG_EDGE_PX = 2048;
const JPEG_QUALITY = 0.85;

// GIF would lose animation, SVG is vector, webp/avif are already
// well-compressed. Picked images are normalized to jpeg/png upstream, so this
// covers everything the composer realistically sends.
const COMPRESSIBLE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export function shouldCompressImage(
  mimeType: string,
  byteSize: number | null | undefined,
): boolean {
  if (!COMPRESSIBLE_MIME_TYPES.has(mimeType)) {
    return false;
  }
  if (byteSize != null && byteSize <= COMPRESSION_TRIGGER_BYTES) {
    return false;
  }
  return true;
}

export interface CompressedImage {
  blob: Blob;
  mimeType: string;
}

/**
 * Returns null when the image should be sent as-is: not compressible, too
 * small, runtime lacks canvas support, decode failed, or the re-encode did
 * not actually shrink the payload.
 */
export async function compressImageBlob(input: {
  blob: Blob;
  mimeType: string;
}): Promise<CompressedImage | null> {
  if (!shouldCompressImage(input.mimeType, input.blob.size)) {
    return null;
  }
  if (typeof createImageBitmap !== "function") {
    return null;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input.blob, { imageOrientation: "from-image" });
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    // Flatten PNG transparency onto white so JPEG output has no black ground.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob || blob.size >= input.blob.size) {
      return null;
    }
    return { blob, mimeType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
