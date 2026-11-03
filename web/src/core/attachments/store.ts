// Port of packages/app/src/attachments/store.ts: the web build only ever uses the IndexedDB
// store, so the native file-system branch (and expo-file-system with it) is left out.
import type { AttachmentStore } from "@/attachments/types";
import { createIndexedDbAttachmentStore } from "@/attachments/web/indexeddb-attachment-store";

let attachmentStorePromise: Promise<AttachmentStore> | null = null;

export async function getAttachmentStore(): Promise<AttachmentStore> {
  if (!attachmentStorePromise) {
    attachmentStorePromise = Promise.resolve(createIndexedDbAttachmentStore());
  }
  return await attachmentStorePromise;
}

/** Test-only hook to inject a deterministic store implementation. */
export function __setAttachmentStoreForTests(store: AttachmentStore | null): void {
  attachmentStorePromise = store ? Promise.resolve(store) : null;
}
