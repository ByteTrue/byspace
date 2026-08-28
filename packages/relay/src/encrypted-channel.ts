/// <reference lib="dom" />
/**
 * Encrypted channel that wraps a WebSocket-like transport.
 *
 * Handles ECDH handshake and encrypts/decrypts all messages.
 * Works identically for daemon and client sides.
 */

import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encryptWithNonce,
  decrypt,
  randomNoncePrefix,
  NONCE_LENGTH,
  NONCE_PREFIX_LENGTH,
  type KeyPair,
  type SharedKey,
} from "./crypto.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import {
  createClientAuthProof,
  generateClientAuthChallenge,
  RELAY_CLIENT_AUTH_SCHEME,
  verifyClientAuthProof,
  type RelayClientAuthentication,
  type RelayClientAuthProof,
} from "./client-auth.js";

export interface Transport {
  send(data: string | ArrayBuffer): void | Promise<void>;
  close(code?: number, reason?: string): void;
  onmessage: ((message: TransportMessage) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
  onerror: ((error: Error) => void) | null;
}

export interface TransportMessage {
  data: string | ArrayBuffer;
  isBinary: boolean;
}

export interface EncryptedChannelEvents {
  onopen?: () => void;
  onmessage?: (data: string | ArrayBuffer) => void;
  onclose?: (code: number, reason: string) => void;
  onerror?: (error: Error) => void;
}

type ChannelState = "connecting" | "handshaking" | "open" | "closed";

interface EncryptedChannelOptions {
  /**
   * If set, the channel can validate repeated plaintext `{type:"e2ee_hello"}`
   * messages even after it is open.
   *
   * This is useful for robustness when the client retries the handshake
   * (e.g., it didn't observe the daemon's `{type:"e2ee_ready"}` yet). In that case,
   * the daemon should re-send `{type:"e2ee_ready"}` without changing keys.
   */
  daemonKeyPair?: KeyPair;
  binaryCiphertext?: boolean;
  requireBinaryCiphertext?: boolean;
}

interface E2EEHelloMessage {
  type: "e2ee_hello";
  key: string;
  capabilities?: E2EECapabilities;
  auth?: RelayClientAuthProof;
}

interface E2EEChallengeMessage {
  type: "e2ee_challenge";
  challenge: string;
  authScheme: typeof RELAY_CLIENT_AUTH_SCHEME;
}

interface E2EEReadyMessage {
  type: "e2ee_ready";
  capabilities?: E2EECapabilities;
}

interface E2EECapabilities {
  binaryCiphertext?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isE2EECapabilities(value: unknown): value is E2EECapabilities {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.binaryCiphertext === undefined || typeof value.binaryCiphertext === "boolean"))
  );
}

function isE2EEHelloMessage(value: unknown): value is E2EEHelloMessage {
  return (
    isRecord(value) &&
    value.type === "e2ee_hello" &&
    typeof value.key === "string" &&
    value.key.trim().length > 0 &&
    isE2EECapabilities(value.capabilities) &&
    (value.auth === undefined ||
      (isRecord(value.auth) &&
        value.auth.scheme === RELAY_CLIENT_AUTH_SCHEME &&
        typeof value.auth.proof === "string" &&
        value.auth.proof.trim().length > 0))
  );
}

function isE2EEChallengeMessage(value: unknown): value is E2EEChallengeMessage {
  return (
    isRecord(value) &&
    value.type === "e2ee_challenge" &&
    typeof value.challenge === "string" &&
    value.challenge.trim().length > 0 &&
    value.authScheme === RELAY_CLIENT_AUTH_SCHEME
  );
}

function isE2EEReadyMessage(value: unknown): value is E2EEReadyMessage {
  return isRecord(value) && value.type === "e2ee_ready" && isE2EECapabilities(value.capabilities);
}

function supportsBinaryCiphertext(message: E2EEHelloMessage | E2EEReadyMessage): boolean {
  return message.capabilities?.binaryCiphertext === true;
}

function buildInvalidHelloError(rawText: string, parsed?: unknown): Error {
  const parsedRecord = isRecord(parsed) ? parsed : null;
  const rawType = parsedRecord?.type;
  function describeType(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    return typeof value;
  }
  const receivedType = describeType(rawType);
  const hasKey = typeof parsedRecord?.key === "string" && parsedRecord.key.trim().length > 0;
  const compact = rawText.replace(/\s+/g, " ").trim();
  const preview = compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
  return new Error(
    `Invalid hello message (receivedType=${receivedType}, hasKey=${hasKey}, preview=${JSON.stringify(preview)})`,
  );
}

const HANDSHAKE_RETRY_MS = 1000;
const MAX_PENDING_SENDS = 200;
const REHANDSHAKE_REJECTION_CODE = 1008;
const ENCRYPTED_PAYLOAD_OVERHEAD_BYTES = 40;

export function base64EncryptedWireByteLength(plaintextBytes: number): number {
  return 4 * Math.ceil((plaintextBytes + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES) / 3);
}

export function maxBase64EncryptedPlaintextByteLength(wireBytes: number): number {
  return Math.floor(wireBytes / 4) * 3 - ENCRYPTED_PAYLOAD_OVERHEAD_BYTES;
}
const REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON = "E2EE re-handshake key mismatch";

interface TimeoutWithUnref {
  unref(): void;
}

function hasUnref(timeout: unknown): timeout is TimeoutWithUnref {
  return (
    typeof timeout === "object" &&
    timeout !== null &&
    "unref" in timeout &&
    typeof (timeout as Record<string, unknown>).unref === "function"
  );
}

/**
 * Creates an encrypted channel as the initiator (client).
 *
 * The client:
 * 1. Receives daemon's public key via QR code
 * 2. Generates own keypair
 * 3. Sends e2ee_hello with own public key
 * 4. Derives shared key and starts encrypted communication
 */
export async function createClientChannel(
  transport: Transport,
  daemonPublicKeyB64: string,
  events: EncryptedChannelEvents = {},
  authentication?: RelayClientAuthentication,
): Promise<EncryptedChannel> {
  const keyPair = generateKeyPair();
  const daemonPublicKey = importPublicKey(daemonPublicKeyB64);
  const sharedKey = deriveSharedKey(keyPair.secretKey, daemonPublicKey);
  const ourPublicKeyB64 = exportPublicKey(keyPair.publicKey);
  const channel = new EncryptedChannel(transport, sharedKey, events, {
    requireBinaryCiphertext: authentication !== undefined,
  });

  let helloText: string | null = authentication
    ? null
    : JSON.stringify({
        type: "e2ee_hello",
        key: ourPublicKeyB64,
        capabilities: { binaryCiphertext: true },
      } satisfies E2EEHelloMessage);
  let retry: ReturnType<typeof setInterval> | null = null;
  let challenge: string | null = null;
  let proofPending = false;

  const emitSendError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    events.onerror?.(err);
  };
  const sendHello = () => {
    if (!helloText) return false;
    try {
      const result = transport.send(helloText);
      if (result) {
        void result.catch(emitSendError);
      }
      return true;
    } catch (error) {
      // This can happen during daemon restarts while the socket transitions
      // through CLOSING/CLOSED states. Report it but do not throw from timers.
      emitSendError(error);
      return false;
    }
  };
  const clearRetry = () => {
    if (retry) {
      clearInterval(retry);
      retry = null;
    }
  };
  const beginRetry = () => {
    if (retry) return;
    sendHello();
    retry = setInterval(() => {
      if (channel.isOpen()) {
        clearRetry();
        return;
      }
      sendHello();
    }, HANDSHAKE_RETRY_MS);
    // Avoid keeping Node processes alive (e.g. tests) if the handshake is stuck.
    if (hasUnref(retry)) {
      retry.unref();
    }
  };

  channel.onTransitionToOpen(() => clearRetry());
  channel.onClose(() => clearRetry());

  if (!authentication) {
    beginRetry();
    return channel;
  }

  const handleChannelMessage = transport.onmessage;
  Object.assign(transport, {
    onmessage: (message: TransportMessage) => {
      if (!message.isBinary) {
        try {
          const parsed: unknown = JSON.parse(decodeTransportText(message.data));
          if (isE2EEChallengeMessage(parsed)) {
            if (challenge && challenge !== parsed.challenge) {
              const error = new Error("Relay E2EE challenge changed during handshake");
              emitSendError(error);
              channel.close(4001, error.message);
              return;
            }
            challenge = parsed.challenge;
            if (helloText) {
              sendHello();
              return;
            }
            if (!proofPending) {
              proofPending = true;
              void createClientAuthProof({
                tokenB64: authentication.clientAuthTokenB64,
                challengeB64: parsed.challenge,
                clientPublicKeyB64: ourPublicKeyB64,
                binaryCiphertext: true,
              })
                .then((auth) => {
                  helloText = JSON.stringify({
                    type: "e2ee_hello",
                    key: ourPublicKeyB64,
                    capabilities: { binaryCiphertext: true },
                    auth,
                  } satisfies E2EEHelloMessage);
                  beginRetry();
                })
                .catch((error: unknown) => {
                  emitSendError(error);
                  channel.close(4001, "Relay client authentication failed");
                });
            }
            return;
          }
        } catch {
          // The encrypted channel owns all non-challenge traffic.
        }
      }
      handleChannelMessage?.(message);
    },
  });

  return channel;
}

/**
 * Creates an encrypted channel as the responder (daemon).
 *
 * The daemon:
 * 1. Has pre-generated keypair (public key was in QR)
 * 2. Waits for client's e2ee_hello with their public key
 * 3. Derives shared key and starts encrypted communication
 */
export async function createDaemonChannel(
  transport: Transport,
  daemonKeyPair: KeyPair,
  events: EncryptedChannelEvents = {},
  authentication?: RelayClientAuthentication,
): Promise<EncryptedChannel> {
  const challenge = authentication ? generateClientAuthChallenge() : null;
  return new Promise((resolve, reject) => {
    const bufferedMessages: TransportMessage[] = [];
    const shouldIgnorePostHelloPlaintext = (message: TransportMessage): boolean => {
      try {
        if (message.isBinary) return false;
        const text = decodeTransportText(message.data);
        const parsed: unknown = JSON.parse(text);
        return isE2EEHelloMessage(parsed) || isE2EEReadyMessage(parsed);
      } catch {
        return false;
      }
    };

    const handleHello = async (message: TransportMessage): Promise<void> => {
      try {
        if (message.isBinary) {
          throw buildInvalidHelloError("<binary frame>");
        }
        const helloText = decodeTransportText(message.data);

        let parsed: unknown;
        try {
          parsed = JSON.parse(helloText);
        } catch {
          throw buildInvalidHelloError(helloText);
        }

        if (!isE2EEHelloMessage(parsed)) {
          throw buildInvalidHelloError(helloText, parsed);
        }

        const msg = parsed;

        // Buffer any subsequent messages while authentication and key
        // derivation run asynchronously. Otherwise the first ciphertext could
        // be misinterpreted as another plaintext hello.
        const bufferNext = (next: TransportMessage): void => {
          bufferedMessages.push(next);
        };
        Object.assign(transport, { onmessage: bufferNext });

        const binaryCiphertext = supportsBinaryCiphertext(msg);
        if (authentication) {
          if (!binaryCiphertext) {
            throw new Error(
              "Authenticated Relay E2EE client did not negotiate binary ciphertext capability",
            );
          }
          if (
            !challenge ||
            !msg.auth ||
            !(await verifyClientAuthProof(
              {
                tokenB64: authentication.clientAuthTokenB64,
                challengeB64: challenge,
                clientPublicKeyB64: msg.key,
                binaryCiphertext,
              },
              msg.auth,
            ))
          ) {
            throw new Error("Invalid Relay client authentication proof");
          }
        }

        const clientPublicKey = importPublicKey(msg.key);
        const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPublicKey);

        await transport.send(
          JSON.stringify({
            type: "e2ee_ready",
            ...(binaryCiphertext
              ? { capabilities: { binaryCiphertext: true } satisfies E2EECapabilities }
              : {}),
          } satisfies E2EEReadyMessage),
        );

        const channel = new EncryptedChannel(transport, sharedKey, events, {
          daemonKeyPair,
          binaryCiphertext,
        });
        channel.setState("open");
        events.onopen?.();

        for (const buffered of bufferedMessages) {
          if (shouldIgnorePostHelloPlaintext(buffered)) continue;
          transport.onmessage?.(buffered);
        }

        resolve(channel);
      } catch (error) {
        reject(error);
      }
    };

    Object.assign(transport, {
      onmessage: handleHello,
      onerror: (error: Error) => {
        reject(error);
      },
      onclose: (code: number, reason: string) => {
        reject(new Error(`Connection closed during handshake: ${code} ${reason}`));
      },
    });

    if (challenge) {
      try {
        const sent = transport.send(
          JSON.stringify({
            type: "e2ee_challenge",
            challenge,
            authScheme: RELAY_CLIENT_AUTH_SCHEME,
          } satisfies E2EEChallengeMessage),
        );
        if (sent) {
          void sent.catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    }
  });
}

/**
 * Encrypted channel that wraps a transport with E2EE.
 */
export class EncryptedChannel {
  private transport: Transport;
  private sharedKey: SharedKey;
  private state: ChannelState = "handshaking";
  private events: EncryptedChannelEvents;
  private options: EncryptedChannelOptions;
  private pendingSends: Array<string | ArrayBuffer> = [];
  private readonly outboundNoncePrefix = randomNoncePrefix();
  private outboundSequence = 0n;
  private inboundNoncePrefix: Uint8Array | null = null;
  private inboundSequence = 0n;
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];

  constructor(
    transport: Transport,
    sharedKey: SharedKey,
    events: EncryptedChannelEvents = {},
    options: EncryptedChannelOptions = {},
  ) {
    this.transport = transport;
    this.sharedKey = sharedKey;
    this.events = events;
    this.options = options;

    Object.assign(transport, {
      onmessage: (message: TransportMessage) => this.handleMessage(message),
      onclose: (code: number, reason: string) => {
        this.state = "closed";
        this.events.onclose?.(code, reason);
        for (const cb of this.onCloseCallbacks) cb();
      },
      onerror: (error: Error) => {
        this.events.onerror?.(error);
      },
    });
  }

  setState(state: ChannelState): void {
    this.state = state;
  }

  private async handleMessage(message: TransportMessage): Promise<void> {
    if (this.state === "handshaking") {
      try {
        if (message.isBinary) return;
        const text = decodeTransportText(message.data);
        const parsed: unknown = JSON.parse(text);
        if (isE2EEReadyMessage(parsed)) {
          const binaryCiphertext = supportsBinaryCiphertext(parsed);
          if (this.options.requireBinaryCiphertext && !binaryCiphertext) {
            const error = new Error(
              "Authenticated Relay E2EE peer did not confirm binary ciphertext capability",
            );
            this.events.onerror?.(error);
            this.state = "closed";
            this.transport.close(4001, error.message);
            return;
          }
          this.options.binaryCiphertext = binaryCiphertext;
          this.state = "open";
          this.events.onopen?.();
          for (const cb of this.onOpenCallbacks) cb();
          try {
            await this.flushPendingSends();
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.events.onerror?.(err);
            this.state = "closed";
            this.transport.close(1011, err.message);
          }
        }
      } catch {
        // ignore non-ready handshake traffic
      }
      return;
    }

    if (this.state !== "open") return;

    try {
      const ciphertext = await (async () => {
        // Handle (or ignore) any stray plaintext handshake traffic.
        try {
          if (message.isBinary) throw new Error("not plaintext handshake traffic");
          const text = decodeTransportText(message.data);
          if (text.trim().startsWith("{")) {
            const parsed: unknown = JSON.parse(text);

            if (isE2EEHelloMessage(parsed)) {
              if (this.options.daemonKeyPair) {
                await this.handleDaemonRehello(parsed);
              }
              return null;
            }

            if (isE2EEReadyMessage(parsed)) {
              return null;
            }

            // Any other JSON-looking payload is plaintext app traffic, which
            // means the peer is not encrypting (or we are out of sync).
            throw new Error("Received plaintext frame on encrypted channel");
          }
        } catch (error) {
          // If we detected plaintext protocol mismatch, fail hard.
          if (error instanceof Error && error.message.includes("plaintext frame")) {
            throw error;
          }
          // Otherwise ignore JSON parse/TextDecoder failures and fall back to
          // decoding ciphertext below.
        }

        if (this.options.binaryCiphertext) {
          return message.isBinary
            ? { data: requireArrayBuffer(message.data), isBinary: true as const }
            : {
                data: base64ToArrayBuffer(decodeTransportText(message.data)),
                isBinary: false as const,
              };
        }

        // COMPAT(binaryCiphertext): added in v0.2.3, remove legacy base64-only
        // receive mode after 2027-01-27.
        if (!message.isBinary) {
          return { data: base64ToArrayBuffer(decodeTransportText(message.data)), isBinary: null };
        }

        // Older transport adapters could lose the opcode. Retain the former
        // base64-first behavior only in the legacy path.
        try {
          return { data: base64ToArrayBuffer(decodeTransportText(message.data)), isBinary: null };
        } catch {
          return { data: requireArrayBuffer(message.data), isBinary: null };
        }
      })();

      if (ciphertext) {
        const plaintextBytes = decrypt(this.sharedKey, ciphertext.data);
        if (this.options.binaryCiphertext) this.acceptInboundNonce(ciphertext.data);
        const plaintext = decodePlaintext(plaintextBytes, ciphertext.isBinary);
        this.events.onmessage?.(plaintext);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Treat decryption/protocol errors as fatal so the peer can reconnect and
      // re-handshake. Emitting an error event here can cause higher-level code
      // to tear down the session without triggering a clean reconnect.
      try {
        this.transport.close(1011, err.message);
      } catch {
        // ignore
      }
    }
  }

  async send(data: string | ArrayBuffer): Promise<void> {
    if (this.state === "handshaking") {
      if (this.pendingSends.length >= MAX_PENDING_SENDS) {
        this.pendingSends.shift();
      }
      this.pendingSends.push(data);
      return;
    }

    if (this.state !== "open") {
      throw new Error("Channel not open");
    }

    const ciphertext = encryptWithNonce(this.sharedKey, data, this.nextOutboundNonce());
    if (this.options.binaryCiphertext && data instanceof ArrayBuffer) {
      await this.transport.send(ciphertext);
      return;
    }
    // COMPAT(binaryCiphertext): added in v0.2.3, remove base64 binary sends
    // after 2027-01-27 once the supported peer floor includes negotiation.
    await this.transport.send(arrayBufferToBase64(ciphertext));
  }

  private nextOutboundNonce(): Uint8Array {
    if (this.outboundSequence > 0xffffffffffffffffn) {
      throw new Error("Encrypted channel nonce sequence exhausted");
    }
    const nonce = new Uint8Array(NONCE_LENGTH);
    nonce.set(this.outboundNoncePrefix, 0);
    new DataView(nonce.buffer).setBigUint64(NONCE_PREFIX_LENGTH, this.outboundSequence);
    this.outboundSequence += 1n;
    return nonce;
  }

  private acceptInboundNonce(bundle: ArrayBuffer): void {
    const nonce = new Uint8Array(bundle, 0, NONCE_LENGTH);
    const prefix = nonce.slice(0, NONCE_PREFIX_LENGTH);
    const sequence = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength).getBigUint64(
      NONCE_PREFIX_LENGTH,
    );
    if (this.inboundNoncePrefix === null) {
      if (sequence !== 0n)
        throw new Error("Encrypted channel nonce sequence did not start at zero");
      this.inboundNoncePrefix = prefix;
    } else if (!keysEqual(prefix, this.inboundNoncePrefix)) {
      throw new Error("Encrypted channel nonce prefix changed");
    }
    if (sequence !== this.inboundSequence) {
      throw new Error("Encrypted channel frame was replayed or reordered");
    }
    this.inboundSequence += 1n;
  }

  outboundWireByteLength(data: string | ArrayBuffer): number {
    const plaintextBytes = utf8ByteLength(data);
    const encryptedBytes = plaintextBytes + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES;
    if (this.options.binaryCiphertext && data instanceof ArrayBuffer) {
      return encryptedBytes;
    }
    return base64EncryptedWireByteLength(plaintextBytes);
  }

  private async flushPendingSends(): Promise<void> {
    if (this.state !== "open") return;
    const pending = this.pendingSends;
    this.pendingSends = [];
    for (const item of pending) {
      await this.send(item);
    }
  }

  private async handleDaemonRehello(message: E2EEHelloMessage): Promise<void> {
    if (!this.options.daemonKeyPair) return;
    const clientPublicKey = importPublicKey(message.key);
    const retryKey = deriveSharedKey(this.options.daemonKeyPair.secretKey, clientPublicKey);
    if (!keysEqual(retryKey, this.sharedKey)) return this.rejectKeyRotation();
    await this.sendReadyForRetry();
  }

  private async sendReadyForRetry(): Promise<void> {
    await this.transport.send(
      JSON.stringify({
        type: "e2ee_ready",
        ...(this.options.binaryCiphertext
          ? { capabilities: { binaryCiphertext: true } satisfies E2EECapabilities }
          : {}),
      } satisfies E2EEReadyMessage),
    );
  }

  private rejectKeyRotation(): void {
    this.state = "closed";
    this.transport.close(REHANDSHAKE_REJECTION_CODE, REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON);
  }

  close(code = 1000, reason = "Normal closure"): void {
    this.state = "closed";
    this.transport.close(code, reason);
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  onTransitionToOpen(cb: () => void): void {
    this.onOpenCallbacks.push(cb);
  }

  onClose(cb: () => void): void {
    this.onCloseCallbacks.push(cb);
  }
}

function decodeTransportText(data: string | ArrayBuffer): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

function requireArrayBuffer(data: string | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  throw new Error("Binary WebSocket frame did not contain bytes");
}

function decodeLegacyPlaintext(data: ArrayBuffer): string | ArrayBuffer {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return data;
  }
}

function decodePlaintext(data: ArrayBuffer, isBinary: boolean | null): string | ArrayBuffer {
  if (isBinary === true) return data;
  if (isBinary === false) return new TextDecoder("utf-8", { fatal: true }).decode(data);
  return decodeLegacyPlaintext(data);
}

function utf8ByteLength(data: string | ArrayBuffer): number {
  return typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

function keysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}
