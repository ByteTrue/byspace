import { useCallback, useRef } from "react";
import { getMimeTypeFromPath } from "@/attachments/file-types";
import type { PickedFile } from "@/attachments/picked-file";

function pickFilesWithWebInput(): Promise<PickedFile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";

    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve(null);
        return;
      }
      resolve(
        await Promise.all(
          files.map(async (file) => ({
            fileName: file.name,
            mimeType: file.type || getMimeTypeFromPath(file.name),
            bytes: new Uint8Array(await file.arrayBuffer()),
          })),
        ),
      );
      input.remove();
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
      return await pickFilesWithWebInput();
    } finally {
      isPickingRef.current = false;
    }
  }, []);
  return { pickFiles };
}
