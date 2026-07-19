export interface PickedImageSource {
  kind: "blob";
  blob: Blob;
}

export interface PickedImageAttachmentInput {
  source: PickedImageSource;
  mimeType?: string | null;
  fileName?: string | null;
}
