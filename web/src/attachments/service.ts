import { collectRetainedAttachmentIds } from "@/attachments/gc-retention";
import { getAttachmentStore } from "@/attachments/store";
import { compressImageBlob, shouldCompressImage } from "@/attachments/compress-image";
import { blobToBase64 } from "@/attachments/utils";
import type { AttachmentMetadata, SaveAttachmentInput } from "@/attachments/types";

const activePersistence = new Set<Promise<AttachmentMetadata>>();
const persistedDuringGarbageCollection = new Set<string>();
let pendingGarbageCollections = 0;
let garbageCollectionTail: Promise<void> = Promise.resolve();
let persistenceBarrier: Promise<void> | null = null;
let releasePersistenceBarrier: (() => void) | null = null;

async function waitForPersistenceBarrier(): Promise<void> {
  const barrier = persistenceBarrier;
  if (!barrier) {
    return;
  }
  await barrier;
  await waitForPersistenceBarrier();
}

async function persistAttachment(input: SaveAttachmentInput): Promise<AttachmentMetadata> {
  await waitForPersistenceBarrier();
  const pending = (async () => {
    const store = await getAttachmentStore();
    const attachment = await store.save(input);
    if (pendingGarbageCollections > 0) {
      persistedDuringGarbageCollection.add(attachment.id);
    }
    return attachment;
  })();
  activePersistence.add(pending);
  try {
    return await pending;
  } finally {
    activePersistence.delete(pending);
  }
}

export async function persistAttachmentFromBlob(input: {
  blob: Blob;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "blob", blob: input.blob },
  });
}

export async function persistAttachmentFromDataUrl(input: {
  dataUrl: string;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "data_url", dataUrl: input.dataUrl },
  });
}

export async function persistAttachmentFromBytes(input: {
  bytes: Uint8Array;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "bytes", bytes: input.bytes },
  });
}

export async function persistAttachmentFromFileUri(input: {
  uri: string;
  mimeType?: string;
  fileName?: string | null;
  id?: string;
}): Promise<AttachmentMetadata> {
  return await persistAttachment({
    id: input.id,
    mimeType: input.mimeType,
    fileName: input.fileName,
    source: { kind: "file_uri", uri: input.uri },
  });
}

export async function encodeAttachmentsForSend(
  attachments: readonly AttachmentMetadata[] | undefined,
): Promise<Array<{ data: string; mimeType: string }> | undefined> {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  const store = await getAttachmentStore();
  const encoded = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        return await encodeAttachmentForSend(store, attachment);
      } catch (error) {
        console.error("[attachments] Failed to encode attachment for send", {
          id: attachment.id,
          error,
        });
        return null;
      }
    }),
  );

  const valid = encoded.filter(
    (entry): entry is { data: string; mimeType: string } => entry !== null,
  );
  return valid.length > 0 ? valid : undefined;
}

/**
 * Wire encoding for one attachment. Large images are downscaled and
 * re-encoded before base64 so a single send_agent_message frame stays under
 * the relay's frame limit; every failure path falls back to the original
 * bytes. The returned mimeType reflects the bytes that were actually
 * encoded, so providers never see a mislabeled payload.
 */
async function encodeAttachmentForSend(
  store: Awaited<ReturnType<typeof getAttachmentStore>>,
  attachment: AttachmentMetadata,
): Promise<{ data: string; mimeType: string }> {
  // Compression is an optimization; every path falls back to the original
  // bytes so a failure here never blocks the send.
  const original = async () => ({
    data: await store.encodeBase64({ attachment }),
    mimeType: attachment.mimeType,
  });

  if (!store.loadBlob || !shouldCompressImage(attachment.mimeType, attachment.byteSize)) {
    return await original();
  }

  try {
    const blob = await store.loadBlob({ attachment });
    const compressed = await compressImageBlob({ blob, mimeType: attachment.mimeType });
    if (!compressed) {
      return await original();
    }
    return {
      data: await blobToBase64(compressed.blob),
      mimeType: compressed.mimeType,
    };
  } catch (error) {
    console.error("[attachments] Image compression failed; sending original", {
      id: attachment.id,
      error,
    });
    return await original();
  }
}

export async function resolveAttachmentPreviewUrl(attachment: AttachmentMetadata): Promise<string> {
  const store = await getAttachmentStore();
  return await store.resolvePreviewUrl({ attachment });
}

export async function releaseAttachmentPreviewUrl(input: {
  attachment: AttachmentMetadata;
  url: string;
}): Promise<void> {
  const store = await getAttachmentStore();
  if (!store.releasePreviewUrl) {
    return;
  }
  await store.releasePreviewUrl({ attachment: input.attachment, url: input.url });
}

export async function deleteAttachments(
  attachments: readonly AttachmentMetadata[] | undefined,
): Promise<void> {
  if (!attachments || attachments.length === 0) {
    return;
  }
  const store = await getAttachmentStore();
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        await store.delete({ attachment });
      } catch (error) {
        console.warn("[attachments] Failed to delete attachment", {
          id: attachment.id,
          error,
        });
      }
    }),
  );
}

export async function garbageCollectAttachments(input: {
  referencedIds: ReadonlySet<string>;
}): Promise<void> {
  pendingGarbageCollections += 1;
  if (!persistenceBarrier) {
    persistenceBarrier = new Promise<void>((resolve) => {
      releasePersistenceBarrier = resolve;
    });
  }

  const previousGarbageCollection = garbageCollectionTail;
  const currentGarbageCollection = (async () => {
    await previousGarbageCollection;
    while (activePersistence.size > 0) {
      await Promise.allSettled(activePersistence);
    }
    const referencedIds = new Set(input.referencedIds);
    for (const id of collectRetainedAttachmentIds()) {
      referencedIds.add(id);
    }
    for (const id of persistedDuringGarbageCollection) {
      referencedIds.add(id);
    }
    const store = await getAttachmentStore();
    await store.garbageCollect({ referencedIds });
  })();
  garbageCollectionTail = currentGarbageCollection.catch(() => undefined);

  try {
    await currentGarbageCollection;
  } finally {
    pendingGarbageCollections -= 1;
    if (pendingGarbageCollections === 0) {
      persistedDuringGarbageCollection.clear();
      const release = releasePersistenceBarrier;
      releasePersistenceBarrier = null;
      persistenceBarrier = null;
      release?.();
    }
  }
}
