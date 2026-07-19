import { getMimeTypeFromPath, isRasterImageFile } from "@/attachments/file-types";
import type { PickedFile } from "@/attachments/picked-file";
import type { DroppedItem } from "@/components/file-drop/types";

export async function droppedItemsToPickedFiles(items: DroppedItem[]): Promise<PickedFile[]> {
  const files: PickedFile[] = [];

  for (const item of items) {
    const file = item.file;
    if (isRasterImageFile(file)) {
      continue;
    }
    files.push({
      fileName: file.name,
      mimeType: file.type || getMimeTypeFromPath(file.name),
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }

  return files;
}
