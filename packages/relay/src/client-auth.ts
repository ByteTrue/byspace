import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";

const AUTH_DOMAIN = new TextEncoder().encode("byspace-relay-client-auth-v1\0");
const TOKEN_BYTES = 32;
const CHALLENGE_BYTES = 32;
const PUBLIC_KEY_BYTES = 32;
const PROOF_BYTES = 32;

export const RELAY_CLIENT_AUTH_SCHEME = "hmac-sha256-v1" as const;

export interface RelayClientAuthProof {
  scheme: typeof RELAY_CLIENT_AUTH_SCHEME;
  proof: string;
}

export interface RelayClientAuthentication {
  clientAuthTokenB64: string;
}

export function generateClientAuthChallenge(): string {
  const challenge = new Uint8Array(CHALLENGE_BYTES);
  globalThis.crypto.getRandomValues(challenge);
  return arrayBufferToBase64(challenge.buffer);
}

export async function createClientAuthProof(input: {
  tokenB64: string;
  challengeB64: string;
  clientPublicKeyB64: string;
  binaryCiphertext: boolean;
}): Promise<RelayClientAuthProof> {
  const token = decodeExact(input.tokenB64, TOKEN_BYTES, "client auth token");
  const proofInput = buildProofInput(input);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    token,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const proof = await globalThis.crypto.subtle.sign("HMAC", key, proofInput);
  return { scheme: RELAY_CLIENT_AUTH_SCHEME, proof: arrayBufferToBase64(proof) };
}

export async function verifyClientAuthProof(
  input: {
    tokenB64: string;
    challengeB64: string;
    clientPublicKeyB64: string;
    binaryCiphertext: boolean;
  },
  auth: RelayClientAuthProof,
): Promise<boolean> {
  if (auth.scheme !== RELAY_CLIENT_AUTH_SCHEME) return false;
  const token = decodeExact(input.tokenB64, TOKEN_BYTES, "client auth token");
  const proof = decodeExact(auth.proof, PROOF_BYTES, "client auth proof");
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    token,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return globalThis.crypto.subtle.verify("HMAC", key, proof, buildProofInput(input));
}

function buildProofInput(input: {
  challengeB64: string;
  clientPublicKeyB64: string;
  binaryCiphertext: boolean;
}): ArrayBuffer {
  const challenge = new Uint8Array(
    decodeExact(input.challengeB64, CHALLENGE_BYTES, "client auth challenge"),
  );
  const publicKey = new Uint8Array(
    decodeExact(input.clientPublicKeyB64, PUBLIC_KEY_BYTES, "client public key"),
  );
  const data = new Uint8Array(AUTH_DOMAIN.length + challenge.length + publicKey.length + 1);
  data.set(AUTH_DOMAIN, 0);
  data.set(challenge, AUTH_DOMAIN.length);
  data.set(publicKey, AUTH_DOMAIN.length + challenge.length);
  data[data.length - 1] = input.binaryCiphertext ? 1 : 0;
  return data.buffer;
}

function decodeExact(value: string, length: number, label: string): ArrayBuffer {
  let bytes: ArrayBuffer;
  try {
    bytes = base64ToArrayBuffer(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (bytes.byteLength !== length) {
    throw new Error(`Invalid ${label}`);
  }
  return bytes;
}
