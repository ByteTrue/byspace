import { useCallback, useRef } from "react";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { getMimeTypeFromPath } from "@/attachments/file-types";
import { readDesktopFileBytes, type PickedFile } from "@/attachments/picked-file";

async function pickFilesWithDesktopDialog(): Promise<PickedFile[] | null> {
  const dialogOpen = getDesktopHost()?.dialog?.open;
  if (typeof dialogOpen !== "function") {
    throw new Error("Desktop dialog API is not available.");
  }

  const selection = await dialogOpen({ directory: false, multiple: true });
  if (!selection) return null;
  const paths = Array.isArray(selection) ? selection : [selection];
  return Promise.all(
    paths.map(async (filePath) => ({
      fileName: filePath.split(/[/\\]/).findLast(Boolean) ?? filePath,
      mimeType: getMimeTypeFromPath(filePath),
      bytes: await readDesktopFileBytes(filePath),
    })),
  );
}

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
      if (isElectronRuntime()) return pickFilesWithDesktopDialog();
      return pickFilesWithWebInput();
    } finally {
      isPickingRef.current = false;
    }
  }, []);
  return { pickFiles };
}
