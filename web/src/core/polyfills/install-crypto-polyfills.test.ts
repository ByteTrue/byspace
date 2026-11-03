import { describe, expect, it } from "vitest";
import { installCryptoPolyfills } from "./install-crypto-polyfills";

const TEST_BYTES = Uint8Array.from([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

function cryptoWithoutRandomUUID(): Crypto {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array && ArrayBuffer.isView(array)) {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(TEST_BYTES);
      }
      return array;
    },
  } as unknown as Crypto;
}

describe("installCryptoPolyfills", () => {
  it("adds a v4 randomUUID drawn from getRandomValues when the context has none", () => {
    const crypto = cryptoWithoutRandomUUID();

    installCryptoPolyfills(crypto);

    expect(crypto.randomUUID()).toBe("00112233-4455-4677-8899-aabbccddeeff");
  });

  it("keeps the browser's own randomUUID", () => {
    const crypto = cryptoWithoutRandomUUID();
    const own = () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as const;
    crypto.randomUUID = own;

    installCryptoPolyfills(crypto);

    expect(crypto.randomUUID).toBe(own);
  });
});
