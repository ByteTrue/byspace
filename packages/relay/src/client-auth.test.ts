import { describe, expect, it } from "vitest";

import { arrayBufferToBase64 } from "./base64.js";
import {
  createClientAuthProof,
  generateClientAuthChallenge,
  verifyClientAuthProof,
} from "./client-auth.js";

function encoded(bytes: number[]): string {
  return arrayBufferToBase64(Uint8Array.from(bytes).buffer);
}

describe("Relay client authentication", () => {
  it("binds the proof to the challenge, client key, and capabilities", async () => {
    const input = {
      tokenB64: encoded(new Array(32).fill(1)),
      challengeB64: encoded(new Array(32).fill(2)),
      clientPublicKeyB64: encoded(new Array(32).fill(3)),
      binaryCiphertext: true,
    };
    const proof = await createClientAuthProof(input);

    await expect(verifyClientAuthProof(input, proof)).resolves.toBe(true);
    await expect(
      verifyClientAuthProof(
        { ...input, challengeB64: encoded(new Array(32).fill(4)) },
        proof,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyClientAuthProof(
        { ...input, clientPublicKeyB64: encoded(new Array(32).fill(5)) },
        proof,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyClientAuthProof({ ...input, binaryCiphertext: false }, proof),
    ).resolves.toBe(false);
  });

  it("generates fresh 32-byte challenges", () => {
    const first = generateClientAuthChallenge();
    const second = generateClientAuthChallenge();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(32);
    expect(Buffer.from(second, "base64")).toHaveLength(32);
  });

  it("rejects malformed key material", async () => {
    await expect(
      createClientAuthProof({
        tokenB64: encoded([1]),
        challengeB64: encoded(new Array(32).fill(2)),
        clientPublicKeyB64: encoded(new Array(32).fill(3)),
        binaryCiphertext: true,
      }),
    ).rejects.toThrow("Invalid client auth token");
  });
});
