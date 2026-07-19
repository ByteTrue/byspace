import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";

interface UseImageAttachmentPickerResult {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
}

function pickImagesWithWebInput(): Promise<PickedImageAttachmentInput[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(
        files.length === 0
          ? null
          : files.map((file) => ({
              source: { kind: "blob" as const, blob: file },
              mimeType: file.type || null,
              fileName: file.name,
            })),
      );
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
