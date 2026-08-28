import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toByteArray } from "base64-js";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import { createClientAuthProof, verifyClientAuthProof } from "./client-auth.js";
import { decrypt, deriveSharedKey, importPublicKey } from "./crypto.js";

interface Fixture {
  version: number;
  algorithm: string;
  framing: string;
  keys: {
    daemonSecretKeyB64: string;
    daemonPublicKeyB64: string;
    clientSecretKeyB64: string;
    clientPublicKeyB64: string;
    sharedKeyB64: string;
  };
  clientAuth: {
    scheme: "hmac-sha256-v1";
    tokenB64: string;
    challengeB64: string;
    clientPublicKeyB64: string;
    binaryCiphertext: boolean;
    proofB64: string;
  };
  vectors: Array<{
    name: string;
    encoding: "utf8" | "base64";
    plaintext?: string;
    plaintextB64?: string;
    nonceB64: string;
    bundleB64: string;
  }>;
  invalid: {
    lowOrderPublicKeyB64: string;
    shortBundleB64: string;
    tamperedBundleB64: string;
  };
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/relay/e2ee-v1.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const decode = (encoded: string): Uint8Array => toByteArray(encoded);
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

function plaintext(vector: Fixture["vectors"][number]): Uint8Array {
  if (vector.encoding === "utf8" && vector.plaintext !== undefined) {
    return new TextEncoder().encode(vector.plaintext);
  }
  if (vector.encoding === "base64" && vector.plaintextB64 !== undefined) {
    return decode(vector.plaintextB64);
  }
  throw new Error(`Invalid plaintext fixture: ${vector.name}`);
}

describe("Go/TypeScript Relay E2EE golden vectors", () => {
  it("locks the algorithm and derives the same shared key in both directions", () => {
    expect(fixture).toMatchObject({
      version: 1,
      algorithm: "curve25519-xsalsa20-poly1305",
      framing: "nonce24-ciphertext",
    });

    const daemonShared = deriveSharedKey(
      decode(fixture.keys.daemonSecretKeyB64),
      importPublicKey(fixture.keys.clientPublicKeyB64),
    );
    const clientShared = deriveSharedKey(
      decode(fixture.keys.clientSecretKeyB64),
      importPublicKey(fixture.keys.daemonPublicKeyB64),
    );

    expect(daemonShared).toEqual(decode(fixture.keys.sharedKeyB64));
    expect(clientShared).toEqual(daemonShared);
  });

  it("reproduces the challenge-bound client authentication proof", async () => {
    const input = {
      tokenB64: fixture.clientAuth.tokenB64,
      challengeB64: fixture.clientAuth.challengeB64,
      clientPublicKeyB64: fixture.clientAuth.clientPublicKeyB64,
      binaryCiphertext: fixture.clientAuth.binaryCiphertext,
    };
    const proof = await createClientAuthProof(input);

    expect(proof).toEqual({
      scheme: fixture.clientAuth.scheme,
      proof: fixture.clientAuth.proofB64,
    });
    await expect(verifyClientAuthProof(input, proof)).resolves.toBe(true);
  });

  it.each(fixture.vectors)("opens and reproduces $name byte-for-byte", (vector) => {
    const sharedKey = decode(fixture.keys.sharedKeyB64);
    const expected = plaintext(vector);
    const nonce = decode(vector.nonceB64);
    const bundle = decode(vector.bundleB64);

    expect(new Uint8Array(decrypt(sharedKey, asArrayBuffer(bundle)))).toEqual(expected);

    const ciphertext = nacl.box.after(expected, nonce, sharedKey);
    const reproduced = new Uint8Array(nonce.length + ciphertext.length);
    reproduced.set(nonce);
    reproduced.set(ciphertext, nonce.length);
    expect(reproduced).toEqual(bundle);
  });

  it("rejects low-order peers, malformed keys, short bundles, and tampering", () => {
    const daemonSecret = decode(fixture.keys.daemonSecretKeyB64);
    expect(() =>
      deriveSharedKey(daemonSecret, importPublicKey(fixture.invalid.lowOrderPublicKeyB64)),
    ).toThrowError("Invalid peer public key");
    expect(() => deriveSharedKey(new Uint8Array(31), importPublicKey(fixture.keys.clientPublicKeyB64))).toThrow();
    expect(() => importPublicKey("AA==")).toThrowError("Invalid public key length (expected 32)");

    const sharedKey = decode(fixture.keys.sharedKeyB64);
    expect(() => decrypt(sharedKey, asArrayBuffer(decode(fixture.invalid.shortBundleB64)))).toThrow();
    expect(() =>
      decrypt(sharedKey, asArrayBuffer(decode(fixture.invalid.tamperedBundleB64))),
    ).toThrowError("Decryption failed");
  });
});
