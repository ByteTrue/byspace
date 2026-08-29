import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizePickedImageFiles,
  type PickedImageAttachmentInput,
} from "@/hooks/image-attachment-picker";

interface UseImageAttachmentPickerResult {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
}

const RASTER_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp";

function pickImagesWithWebInput(): Promise<PickedImageAttachmentInput[] | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = RASTER_IMAGE_ACCEPT;
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(normalizePickedImageFiles(files));
      } catch (error) {
        reject(error);
      }
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function useImageAttachmentPicker(): UseImageAttachmentPickerResult {
  const { t } = useTranslation();
  const isPickingRef = useRef(false);
  const pickImages = useCallback(async () => {
    if (isPickingRef.current) return null;
    isPickingRef.current = true;
    try {
      return await pickImagesWithWebInput();
    } catch (error) {
      console.error("[ImageAttachmentPicker] Failed to pick image:", error);
      window.alert(t("imageAttachmentPicker.failedToSelect"));
      return null;
    } finally {
      isPickingRef.current = false;
    }
  }, [t]);
  return { pickImages };
}
