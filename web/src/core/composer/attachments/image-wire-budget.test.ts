import { describe, expect, it } from "vitest";
import type { AgentAttachment, UploadedFileAttachment } from "@bytetrue/protocol/messages";
import {
  enforceImageWireBudget,
  IMAGE_INLINE_WIRE_BUDGET_BYTES,
  selectInlineImages,
} from "./image-wire-budget";

const MIB = 1024 * 1024;

function inlineImage(megabytes: number, mimeType = "image/png") {
  // "QUFB" encodes three 0x41 bytes, so each repeat contributes 4 base64
  // chars (the wire unit) decoding to 3 bytes of value 65.
  return { data: "QUFB".repeat((megabytes * MIB) / 4), mimeType };
}

describe("selectInlineImages", () => {
  it("keeps everything inline when the payload fits", () => {
    const result = selectInlineImages({
      images: [inlineImage(1), inlineImage(2)],
      textByteLength: 100,
      attachmentsByteLength: 100,
    });
    expect(result.inlineIndexes).toEqual([0, 1]);
    expect(result.overflowIndexes).toEqual([]);
  });

  it("keeps the largest count of images and overflows the biggest", () => {
    const result = selectInlineImages({
      images: [inlineImage(12), inlineImage(2), inlineImage(2)],
      textByteLength: 0,
      attachmentsByteLength: 0,
    });
    expect(result.inlineIndexes).toEqual([1, 2]);
    expect(result.overflowIndexes).toEqual([0]);
  });

  it("overflows everything when the fixed content alone exhausts the budget", () => {
    const result = selectInlineImages({
      images: [inlineImage(1)],
      textByteLength: IMAGE_INLINE_WIRE_BUDGET_BYTES,
      attachmentsByteLength: 0,
    });
    expect(result.inlineIndexes).toEqual([]);
    expect(result.overflowIndexes).toEqual([0]);
  });

  it("keeps the original order in both outputs", () => {
    const result = selectInlineImages({
      images: [inlineImage(9), inlineImage(1), inlineImage(9)],
      textByteLength: 0,
      attachmentsByteLength: 0,
    });
    expect(result.inlineIndexes).toEqual([0, 1]);
    expect(result.overflowIndexes).toEqual([2]);
  });
});

describe("enforceImageWireBudget", () => {
  function createUploadClient(
    overrides: {
      file?: UploadedFileAttachment | null;
      error?: string | null;
      fail?: boolean;
    } = {},
  ) {
    const uploads: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }> = [];
    return {
      uploads,
      client: {
        uploadFile: async (input: { fileName: string; mimeType: string; bytes: Uint8Array }) => {
          uploads.push(input);
          if (overrides.fail) {
            throw new Error("upload failed");
          }
          const file: UploadedFileAttachment | null =
            overrides.file !== undefined
              ? overrides.file
              : {
                  type: "uploaded_file",
                  id: `file_${uploads.length}`,
                  fileName: input.fileName,
                  mimeType: input.mimeType,
                  size: input.bytes.byteLength,
                  path: `/uploads/file_${uploads.length}/${input.fileName}`,
                };
          return {
            requestId: "req_1",
            file,
            error: overrides.error ?? null,
          };
        },
      },
    };
  }

  it("returns the payload untouched when everything fits", async () => {
    const { client, uploads } = createUploadClient();
    const images = [inlineImage(1)];
    const attachments: AgentAttachment[] = [{ type: "text", mimeType: "text/plain", text: "note" }];

    const result = await enforceImageWireBudget({ client, text: "hi", images, attachments });

    expect(uploads).toEqual([]);
    expect(result.images).toBe(images);
    expect(result.attachments).toBe(attachments);
  });

  it("uploads overflowing images and appends them as file attachments", async () => {
    const { client, uploads } = createUploadClient();
    const images = [inlineImage(12), inlineImage(2), inlineImage(2)];

    const result = await enforceImageWireBudget({
      client,
      text: "hi",
      images,
      attachments: [],
      fileNames: [null, "shot-small.png", "shot-smaller.png"],
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.fileName).toBe("image.png");
    // data.length counts base64 chars (the wire unit); decoding yields 3/4 as many bytes.
    const uploadedBytes = uploads[0]?.bytes;
    expect(uploadedBytes?.byteLength).toBe((12 * MIB * 3) / 4);
    expect(uploadedBytes?.[0]).toBe(65);
    expect(uploadedBytes?.[uploadedBytes.length - 1]).toBe(65);
    expect(result.images).toEqual([images[1], images[2]]);
    expect(result.attachments).toEqual([
      {
        type: "uploaded_file",
        id: "file_1",
        fileName: "image.png",
        mimeType: "image/png",
        size: (12 * MIB * 3) / 4,
        path: "/uploads/file_1/image.png",
      },
    ]);
  });

  it("keeps an image inline when its upload fails", async () => {
    const { client, uploads } = createUploadClient({ fail: true });
    // A single 15 MiB image exceeds the usable budget on its own.
    const images = [inlineImage(15)];

    const result = await enforceImageWireBudget({
      client,
      text: "hi",
      images,
      attachments: [],
    });

    expect(uploads).toHaveLength(1);
    expect(result.images).toEqual([images[0]]);
    expect(result.attachments).toEqual([]);
  });

  it("keeps an image inline when the daemon reports an upload error", async () => {
    const { client, uploads } = createUploadClient({ file: null, error: "disk full" });
    const images = [inlineImage(15)];

    const result = await enforceImageWireBudget({
      client,
      text: "hi",
      images,
      attachments: [],
    });

    expect(uploads).toHaveLength(1);
    expect(result.images).toEqual([images[0]]);
    expect(result.attachments).toEqual([]);
  });

  it("returns the payload untouched for empty images", async () => {
    const { client, uploads } = createUploadClient();

    const result = await enforceImageWireBudget({
      client,
      text: "hi",
      images: [],
      attachments: [],
    });

    expect(uploads).toEqual([]);
    expect(result.images).toEqual([]);
    expect(result.attachments).toEqual([]);
  });
});
