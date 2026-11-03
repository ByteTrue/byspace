import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";

export interface ClipboardImageReader {
  readImageDataUrl: () => Promise<string | null>;
}

export async function readClipboardImage(
  clipboard: ClipboardImageReader,
): Promise<PickedImageAttachmentInput | null> {
  const dataUrl = await clipboard.readImageDataUrl();
  if (!dataUrl) {
    return null;
  }

  return {
    source: { kind: "data_url", dataUrl },
    mimeType: "image/png",
    fileName: "clipboard.png",
  };
}
