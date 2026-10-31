// Override of packages/app/src/hooks/use-file-picker.ts: the browser's file dialog only.
import { useCallback, useRef } from "react";
import { getMimeTypeFromPath } from "@/attachments/file-types";
import type { PickedFile } from "@/attachments/picked-file";

/** Opens the file dialog; resolves the chosen files, or null when cancelled. */
export function pickFilesWithInput(accept?: string): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (accept) input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files.length > 0 ? files : null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function useFilePicker() {
  const isPickingRef = useRef(false);
  const pickFiles = useCallback(async (): Promise<PickedFile[] | null> => {
    if (isPickingRef.current) return null;
    isPickingRef.current = true;
    try {
      const files = await pickFilesWithInput();
      if (!files) return null;
      return await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || getMimeTypeFromPath(file.name),
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
    } catch (error) {
      console.error("[FilePicker] Failed to pick files:", error);
      throw error;
    } finally {
      isPickingRef.current = false;
    }
  }, []);
  return { pickFiles };
}
