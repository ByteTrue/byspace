import { useCallback, useRef } from "react";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { getMimeTypeFromPath } from "@/attachments/file-types";
import type { PickedFile } from "@/attachments/picked-file";

async function pickFilesWithDocumentPicker(): Promise<PickedFile[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });

  if (result.canceled || result.assets.length === 0) return null;

  return await Promise.all(
    result.assets.map(async (asset) => ({
      fileName: asset.name,
      mimeType: asset.mimeType ?? getMimeTypeFromPath(asset.name),
      bytes: await new File(asset.uri).bytes(),
    })),
  );
}

export function useFilePicker() {
  const isPickingRef = useRef(false);
  const pickFiles = useCallback(async (): Promise<PickedFile[] | null> => {
    if (isPickingRef.current) return null;
    isPickingRef.current = true;
    try {
      return await pickFilesWithDocumentPicker();
    } catch (error) {
      console.error("[FilePicker] Failed to pick files:", error);
      throw error;
    } finally {
      isPickingRef.current = false;
    }
  }, []);
  return { pickFiles };
}
