import type { DesktopDialogBridge } from "@/desktop/host";
import { RASTER_IMAGE_FILE_EXTENSIONS, resolveRasterImageMimeType } from "@/attachments/file-types";
import { getFileNameFromPath } from "@/attachments/utils";
import { i18n } from "@/i18n/i18next";
import { isAbsolutePath } from "@/utils/path";

export type PickedImageSource =
  | { kind: "file_uri"; uri: string }
  | { kind: "blob"; blob: Blob }
  | { kind: "data_url"; dataUrl: string };

export interface PickedImageAttachmentInput {
  source: PickedImageSource;
  mimeType: string;
  fileName?: string | null;
}

export interface ExpoImagePickerAssetLike {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  file?: File | null;
}

function requirePickedImageMimeType(input: {
  mimeType?: string | null;
  path?: string | null;
}): string {
  const mimeType = resolveRasterImageMimeType(input);
  if (!mimeType) {
    throw new Error(`Unsupported image type for '${input.path ?? "selected image"}'.`);
  }
  return mimeType;
}

async function blobFromUri(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Failed to read picked image from '${uri}'.`);
  return await response.blob();
}

export async function normalizePickedImageAssets(
  assets: readonly ExpoImagePickerAssetLike[],
): Promise<PickedImageAttachmentInput[]> {
  return await Promise.all(
    assets.map(async (asset) => {
      if (asset.file instanceof Blob) {
        const fileName = asset.fileName ?? asset.file.name ?? null;
        return {
          source: { kind: "blob" as const, blob: asset.file },
          mimeType: requirePickedImageMimeType({
            mimeType: asset.mimeType || asset.file.type,
            path: fileName ?? asset.uri,
          }),
          fileName,
        };
      }

      if (asset.uri.startsWith("file://") || isAbsolutePath(asset.uri)) {
        return {
          source: { kind: "file_uri" as const, uri: asset.uri },
          mimeType: requirePickedImageMimeType({
            mimeType: asset.mimeType,
            path: asset.fileName ?? asset.uri,
          }),
          fileName: asset.fileName ?? null,
        };
      }

      const blob = await blobFromUri(asset.uri);
      return {
        source: { kind: "blob" as const, blob },
        mimeType: requirePickedImageMimeType({
          mimeType: asset.mimeType || blob.type,
          path: asset.fileName ?? asset.uri,
        }),
        fileName: asset.fileName ?? null,
      };
    }),
  );
}

export function normalizePickedImageFiles(files: readonly File[]): PickedImageAttachmentInput[] {
  return files.map((file) => {
    const mimeType = requirePickedImageMimeType({ mimeType: file.type, path: file.name });
    return {
      source: { kind: "blob", blob: file },
      mimeType,
      fileName: file.name,
    };
  });
}

function normalizeDesktopDialogSelection(selection: string | string[] | null): string[] {
  if (!selection) return [];
  return Array.isArray(selection) ? selection : [selection];
}

export async function pickImagesWithDesktopDialog(
  dialog: DesktopDialogBridge | null | undefined,
): Promise<PickedImageAttachmentInput[]> {
  const dialogOpen = dialog?.open;
  if (typeof dialogOpen !== "function") {
    throw new Error("Desktop dialog API is not available.");
  }

  const selection = await dialogOpen({
    directory: false,
    multiple: true,
    filters: [
      {
        name: i18n.t("imageAttachmentPicker.dialogFilterName"),
        extensions: RASTER_IMAGE_FILE_EXTENSIONS,
      },
    ],
    title: i18n.t("imageAttachmentPicker.dialogTitle"),
  });

  return normalizeDesktopDialogSelection(selection).map((path) => ({
    source: { kind: "file_uri" as const, uri: path },
    mimeType: requirePickedImageMimeType({ path }),
    fileName: getFileNameFromPath(path),
  }));
}
