import type { AgentAttachment, UploadedFileAttachment } from "@bytetrue/protocol/messages";

/**
 * Wire budget for inline images in one send frame.
 *
 * The relay's binding frame limit is 32 MiB on the wire; frames are E2EE
 * encrypted then base64-encoded, so the plaintext JSON envelope must stay
 * under ~24 MiB. 16 MiB leaves headroom for the envelope, text, and
 * serialized attachments. Images that do not fit are moved to the chunked
 * file-upload channel and referenced by path instead.
 */
export const IMAGE_INLINE_WIRE_BUDGET_BYTES = 16 * 1024 * 1024;
const NON_IMAGE_WIRE_ALLOWANCE_BYTES = 2 * 1024 * 1024;

export interface InlineImagePayload {
  data: string; // base64
  mimeType: string;
}

export interface ImageBudgetUploadClient {
  uploadFile: (input: { fileName: string; mimeType: string; bytes: Uint8Array }) => Promise<{
    requestId: string;
    file: UploadedFileAttachment | null;
    error: string | null;
  }>;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function defaultImageFileName(mimeType: string): string {
  return `image.${IMAGE_FILE_EXTENSIONS[mimeType] ?? "jpg"}`;
}

/**
 * Picks which images stay inline. Keeps the largest possible *count* of
 * images (smallest first) so a message with many screenshots loses as few as
 * possible. Returned indexes preserve the original order.
 */
export function selectInlineImages(input: {
  images: InlineImagePayload[];
  textByteLength: number;
  attachmentsByteLength: number;
}): { inlineIndexes: number[]; overflowIndexes: number[] } {
  const budget = IMAGE_INLINE_WIRE_BUDGET_BYTES;
  const usable =
    budget - NON_IMAGE_WIRE_ALLOWANCE_BYTES - input.textByteLength - input.attachmentsByteLength;

  const allIndexes = input.images.map((_, index) => index);
  if (usable <= 0) {
    return { inlineIndexes: [], overflowIndexes: allIndexes };
  }

  const bySize = input.images
    .map((image, index) => ({ index, byteLength: image.data.length }))
    .sort((a, b) => a.byteLength - b.byteLength);

  const inline = new Set<number>();
  let used = 0;
  for (const entry of bySize) {
    if (used + entry.byteLength > usable) {
      continue;
    }
    inline.add(entry.index);
    used += entry.byteLength;
  }

  return {
    inlineIndexes: allIndexes.filter((index) => inline.has(index)),
    overflowIndexes: allIndexes.filter((index) => !inline.has(index)),
  };
}

/**
 * Sends oversized images through the chunked file-upload channel and returns
 * them as uploaded_file attachments. An upload that fails falls back to
 * keeping the image inline — the pre-existing behavior (which fails against
 * the relay frame limit) is the floor; this path is the improvement.
 */
export async function enforceImageWireBudget(input: {
  client: ImageBudgetUploadClient;
  text: string;
  images: InlineImagePayload[];
  attachments: AgentAttachment[];
  /** Parallel to `images`; ignored when the lengths drift apart. */
  fileNames?: Array<string | null | undefined>;
}): Promise<{ images: InlineImagePayload[]; attachments: AgentAttachment[] }> {
  const { images } = input;
  if (images.length === 0) {
    return { images, attachments: input.attachments };
  }

  const { inlineIndexes, overflowIndexes } = selectInlineImages({
    images,
    textByteLength: utf8ByteLength(input.text),
    attachmentsByteLength: utf8ByteLength(JSON.stringify(input.attachments)),
  });
  if (overflowIndexes.length === 0) {
    return { images, attachments: input.attachments };
  }

  console.warn("[composer] moving oversized images to chunked file upload", {
    inline: inlineIndexes.length,
    overflow: overflowIndexes.length,
  });

  const fileNames =
    input.fileNames && input.fileNames.length === images.length ? input.fileNames : undefined;
  const inlineSet = new Set(inlineIndexes);
  const inlineImages: InlineImagePayload[] = [];
  const uploadedAttachments: AgentAttachment[] = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (inlineSet.has(index)) {
      inlineImages.push(image);
      continue;
    }
    try {
      const response = await input.client.uploadFile({
        fileName: fileNames?.[index] || defaultImageFileName(image.mimeType),
        mimeType: image.mimeType,
        bytes: base64ToBytes(image.data),
      });
      if (response.file) {
        uploadedAttachments.push(response.file);
        continue;
      }
      console.error("[composer] oversized image upload failed; keeping it inline", {
        index,
        error: response.error,
      });
    } catch (error) {
      console.error("[composer] oversized image upload failed; keeping it inline", {
        index,
        error,
      });
    }
    inlineImages.push(image);
  }

  return {
    images: inlineImages,
    attachments: [...input.attachments, ...uploadedAttachments],
  };
}
