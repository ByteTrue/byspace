import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nativeStore: { storageType: "native-file" },
  createNativeFileAttachmentStore: vi.fn(),
}));

vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("./native/native-file-attachment-store", () => ({
  createNativeFileAttachmentStore: mocks.createNativeFileAttachmentStore,
}));

import { __setAttachmentStoreForTests, getAttachmentStore } from "./store";

describe("native attachment store", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
    mocks.createNativeFileAttachmentStore.mockReset();
  });

  it("uses the native file store instead of IndexedDB", async () => {
    mocks.createNativeFileAttachmentStore.mockReturnValue(mocks.nativeStore);

    const store = await getAttachmentStore();

    expect(store).toBe(mocks.nativeStore);
    expect(mocks.createNativeFileAttachmentStore).toHaveBeenCalledOnce();
  });
});
