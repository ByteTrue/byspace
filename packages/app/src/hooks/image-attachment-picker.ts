import { resolveRasterImageMimeType } from "@/attachments/file-types";

export interface PickedImageSource {
  kind: "blob";
  blob: Blob;
}

export interface PickedImageAttachmentInput {
  source: PickedImageSource;
  mimeType: string;
  fileName?: string | null;
}

export function normalizePickedImageFiles(files: readonly File[]): PickedImageAttachmentInput[] {
  return files.map((file) => {
    const mimeType = resolveRasterImageMimeType({
      mimeType: file.type,
      path: file.name,
    });
    if (!mimeType) {
      throw new Error(`Unsupported image type for '${file.name}'.`);
    }
    return {
      source: { kind: "blob", blob: file },
      mimeType,
      fileName: file.name,
    };
  });
}
