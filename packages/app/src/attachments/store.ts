import type { AttachmentStore } from "@/attachments/types";

let attachmentStorePromise: Promise<AttachmentStore> | null = null;

async function createAttachmentStore(): Promise<AttachmentStore> {
  const { createIndexedDbAttachmentStore } = await import("./web/indexeddb-attachment-store");
  return createIndexedDbAttachmentStore();
}

export async function getAttachmentStore(): Promise<AttachmentStore> {
  if (!attachmentStorePromise) {
    attachmentStorePromise = createAttachmentStore();
  }
  return await attachmentStorePromise;
}

/** Test-only hook to inject a deterministic store implementation. */
export function __setAttachmentStoreForTests(store: AttachmentStore | null): void {
  attachmentStorePromise = store ? Promise.resolve(store) : null;
}
