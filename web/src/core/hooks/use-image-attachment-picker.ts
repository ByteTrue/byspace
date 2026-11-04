// Port of archive/expo-app:packages/app/src/hooks/use-image-attachment-picker.ts: the browser's file dialog,
// images only. No permission prompt exists on the web.
import { showAlert } from "~/lib/alert";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizePickedImageAssets,
  type PickedImageAttachmentInput,
} from "@/hooks/image-attachment-picker";
import { pickFilesWithInput } from "@/hooks/use-file-picker";

export function useImageAttachmentPicker(): {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
} {
  const { t } = useTranslation();
  const isPickingRef = useRef(false);
  const pickImages = useCallback(async () => {
    if (isPickingRef.current) return null;
    isPickingRef.current = true;
    try {
      const files = await pickFilesWithInput("image/*");
      if (!files) return null;
      return await normalizePickedImageAssets(
        files.map((file) => ({ uri: "", mimeType: file.type, fileName: file.name, file })),
      );
    } catch (error) {
      console.error("[ImageAttachmentPicker] Failed to pick image:", error);
      showAlert(t("imageAttachmentPicker.errorTitle"), t("imageAttachmentPicker.failedToSelect"));
      return null;
    } finally {
      isPickingRef.current = false;
    }
  }, [t]);
  return { pickImages };
}
