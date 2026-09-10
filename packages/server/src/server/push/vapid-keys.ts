import { existsSync, readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import type pino from "pino";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Application server keys for Web Push (RFC 8292).
 *
 * The key pair identifies this daemon to the browser's push service. Rotating it
 * invalidates every existing subscription, so the pair is generated once and then
 * reused for the lifetime of the BySpace home directory.
 */
export function loadOrCreateVapidKeys(options: {
  logger: pino.Logger;
  filePath: string;
}): VapidKeys | null {
  const existing = readVapidKeys(options.filePath);
  if (existing) {
    return existing;
  }

  try {
    const created = generateVapidKeys();
    writePrivateFileAtomicSync(options.filePath, `${JSON.stringify(created, null, 2)}\n`);
    options.logger.info({ filePath: options.filePath }, "Generated Web Push application keys");
    return created;
  } catch (error) {
    options.logger.error({ err: error }, "Failed to generate Web Push application keys");
    return null;
  }
}

function readVapidKeys(filePath: string): VapidKeys | null {
  if (!existsSync(filePath)) {
    return null;
  }
  // This file holds the private key. A copy restored from a backup or written
  // under a loose umask would otherwise keep its mode forever.
  ensurePrivateFile(filePath);
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { publicKey, privateKey } = parsed as Partial<VapidKeys>;
    if (typeof publicKey !== "string" || typeof privateKey !== "string") {
      return null;
    }
    if (publicKey.trim().length === 0 || privateKey.trim().length === 0) {
      return null;
    }
    return { publicKey: publicKey.trim(), privateKey: privateKey.trim() };
  } catch {
    return null;
  }
}

/**
 * P-256 key pair encoded the way the Push API expects: the public key is the
 * uncompressed EC point and the private key is the raw scalar, both base64url.
 */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });

  const x = requireJwkComponent(publicJwk.x, "x");
  const y = requireJwkComponent(publicJwk.y, "y");
  const d = requireJwkComponent(privateJwk.d, "d");

  const point = Buffer.concat([
    Buffer.of(0x04),
    fromBase64Url(x, 32, "x"),
    fromBase64Url(y, 32, "y"),
  ]);

  return {
    publicKey: point.toString("base64url"),
    privateKey: fromBase64Url(d, 32, "d").toString("base64url"),
  };
}

function requireJwkComponent(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Generated P-256 key is missing its "${name}" component`);
  }
  return value;
}

function fromBase64Url(value: string, expectedLength: number, name: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === expectedLength) {
    return decoded;
  }
  // Node omits leading zero bytes in JWK components; left-pad to the fixed width.
  if (decoded.length < expectedLength) {
    return Buffer.concat([Buffer.alloc(expectedLength - decoded.length), decoded]);
  }
  throw new Error(
    `P-256 component "${name}" is ${decoded.length} bytes, expected ${expectedLength}`,
  );
}
