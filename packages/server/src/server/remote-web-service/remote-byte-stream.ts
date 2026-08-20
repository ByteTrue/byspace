import { createHash, timingSafeEqual } from "node:crypto";
import { Duplex } from "node:stream";

const DEFAULT_INITIAL_CREDIT_BYTES = 256 * 1024;
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;
const MAX_CREDIT_BYTES = 64 * 1024 * 1024;
const DATA_SEQUENCE_PREFIX_BYTES = 8;
const DATA_SESSION_DIGEST_BYTES = 16;
const DATA_HEADER_BYTES = DATA_SEQUENCE_PREFIX_BYTES + DATA_SESSION_DIGEST_BYTES;

export interface RemoteByteStreamTransport {
  send(data: string | ArrayBuffer): Promise<void>;
  close(code?: number, reason?: string): void;
}

interface PendingWrite {
  buffer: Buffer;
  offset: number;
  callback: (error?: Error | null) => void;
}

type ControlFrame =
  | { type: "window"; bytes: number; sequence: number; sessionId: string }
  | { type: "end"; sequence: number; sessionId: string }
  | { type: "reset"; sequence: number; sessionId: string };

type OutboundControlFrame = { type: "window"; bytes: number } | { type: "end" } | { type: "reset" };

function parseControlFrame(raw: string): ControlFrame | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const frame = parsed as Record<string, unknown>;
    if (
      typeof frame.sequence !== "number" ||
      !Number.isSafeInteger(frame.sequence) ||
      frame.sequence < 0
    ) {
      return null;
    }
    if (
      typeof frame.sessionId !== "string" ||
      frame.sessionId.length === 0 ||
      frame.sessionId.length > 128
    ) {
      return null;
    }
    if (frame.type === "end" || frame.type === "reset") {
      return { type: frame.type, sequence: frame.sequence, sessionId: frame.sessionId };
    }
    if (
      frame.type === "window" &&
      typeof frame.bytes === "number" &&
      Number.isSafeInteger(frame.bytes) &&
      frame.bytes > 0 &&
      frame.bytes <= MAX_CREDIT_BYTES
    ) {
      return {
        type: "window",
        bytes: frame.bytes,
        sequence: frame.sequence,
        sessionId: frame.sessionId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function encodeDataFrame(buffer: Buffer, sequence: number, sessionDigest: Buffer): ArrayBuffer {
  const frame = Buffer.allocUnsafe(DATA_HEADER_BYTES + buffer.byteLength);
  frame.writeBigUInt64BE(BigInt(sequence), 0);
  sessionDigest.copy(frame, DATA_SEQUENCE_PREFIX_BYTES);
  buffer.copy(frame, DATA_HEADER_BYTES);
  return toArrayBuffer(frame);
}

function parseDataFrame(
  data: ArrayBuffer,
  expectedSessionDigest: Buffer,
): { chunk: Buffer; sequence: number } | null {
  if (data.byteLength <= DATA_HEADER_BYTES) return null;
  const frame = Buffer.from(data);
  const sequence = frame.readBigUInt64BE(0);
  if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const sessionDigest = frame.subarray(DATA_SEQUENCE_PREFIX_BYTES, DATA_HEADER_BYTES);
  if (!timingSafeEqual(sessionDigest, expectedSessionDigest)) return null;
  return {
    sequence: Number(sequence),
    chunk: frame.subarray(DATA_HEADER_BYTES),
  };
}

export interface RemoteByteStreamOptions {
  sessionId: string;
  initialCreditBytes?: number;
  maxFrameBytes?: number;
}

export class RemoteByteStream extends Duplex {
  private readonly initialCreditBytes: number;
  private readonly maxFrameBytes: number;
  private readonly sessionId: string;
  private readonly sessionDigest: Buffer;
  private sendCreditBytes: number;
  private uncreditedReadBytes = 0;
  private pendingWrite: PendingWrite | null = null;
  private flushing = false;
  private localEnded = false;
  private remoteEnded = false;
  private transportClosed = false;
  private sendSequence = 0;
  private receiveSequence = 0;
  private sendOperation: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: RemoteByteStreamTransport,
    options: RemoteByteStreamOptions,
  ) {
    super({ allowHalfOpen: true });
    this.sessionId = options.sessionId.trim();
    if (!this.sessionId || this.sessionId.length > 128) {
      throw new Error("Remote Web Service sessionId is invalid");
    }
    this.sessionDigest = createHash("sha256")
      .update(this.sessionId)
      .digest()
      .subarray(0, DATA_SESSION_DIGEST_BYTES);
    this.initialCreditBytes = options.initialCreditBytes ?? DEFAULT_INITIAL_CREDIT_BYTES;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    if (
      !Number.isSafeInteger(this.initialCreditBytes) ||
      this.initialCreditBytes <= 0 ||
      this.initialCreditBytes > MAX_CREDIT_BYTES
    ) {
      throw new Error("initialCreditBytes is out of range");
    }
    if (
      !Number.isSafeInteger(this.maxFrameBytes) ||
      this.maxFrameBytes <= 0 ||
      this.maxFrameBytes > this.initialCreditBytes
    ) {
      throw new Error("maxFrameBytes is out of range");
    }
    this.sendCreditBytes = this.initialCreditBytes;
  }

  receive(data: string | ArrayBuffer): void {
    if (this.destroyed) return;
    if (typeof data === "string") {
      const frame = parseControlFrame(data);
      if (!frame || frame.sessionId !== this.sessionId || !this.acceptSequence(frame.sequence)) {
        this.destroy(new Error("Invalid or replayed Remote Web Service frame"));
        return;
      }
      if (frame.type === "window") {
        if (this.sendCreditBytes + frame.bytes > MAX_CREDIT_BYTES) {
          this.destroy(new Error("Remote Web Service credit limit exceeded"));
          return;
        }
        this.sendCreditBytes += frame.bytes;
        void this.flushPendingWrite();
        return;
      }
      if (frame.type === "reset") {
        this.destroy(new Error("Remote Web Service stream reset"));
        return;
      }
      if (this.remoteEnded) {
        this.destroy(new Error("Duplicate Remote Web Service end frame"));
        return;
      }
      this.remoteEnded = true;
      this.push(null);
      return;
    }

    const frame = parseDataFrame(data, this.sessionDigest);
    if (
      !frame ||
      !this.acceptSequence(frame.sequence) ||
      this.remoteEnded ||
      frame.chunk.byteLength > this.maxFrameBytes
    ) {
      this.destroy(new Error("Invalid or replayed Remote Web Service data frame"));
      return;
    }
    const chunk = frame.chunk;
    this.uncreditedReadBytes += chunk.byteLength;
    if (this.uncreditedReadBytes > this.initialCreditBytes) {
      this.destroy(new Error("Remote Web Service receive window exceeded"));
      return;
    }
    this.push(chunk);
    if (this.readableFlowing) queueMicrotask(() => this.acknowledgeConsumedBytes());
  }

  receiveClose(code = 1006, reason = "Remote Web Service transport closed"): void {
    if (this.destroyed) return;
    if (this.localEnded && this.remoteEnded && code === 1000) {
      this.closeTransportOnce();
      this.destroy();
      return;
    }
    this.destroy(new Error(reason || `Remote Web Service transport closed (${code})`));
  }

  override read(size?: number): unknown {
    const chunk = super.read(size);
    if (chunk !== null) queueMicrotask(() => this.acknowledgeConsumedBytes());
    return chunk;
  }

  override _read(): void {
    this.acknowledgeConsumedBytes();
  }

  override _write(
    chunk: Buffer | Uint8Array | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    let buffer: Buffer;
    if (Buffer.isBuffer(chunk)) buffer = chunk;
    else if (typeof chunk === "string") buffer = Buffer.from(chunk, encoding);
    else buffer = Buffer.from(chunk);
    this.pendingWrite = { buffer, offset: 0, callback };
    void this.flushPendingWrite();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.localEnded = true;
    void this.sendEnd(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    const pending = this.pendingWrite;
    this.pendingWrite = null;
    pending?.callback(error ?? new Error("Remote Web Service stream closed"));
    this.closeTransportOnce(error ? 1011 : 1000, error?.message);
    callback(error);
  }

  private acknowledgeConsumedBytes(): void {
    if (this.destroyed) return;
    const bytes = this.uncreditedReadBytes - this.readableLength;
    if (bytes <= 0) return;
    this.uncreditedReadBytes -= bytes;
    void this.enqueueControl({ type: "window", bytes }).catch((error: unknown) => {
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private async flushPendingWrite(): Promise<void> {
    if (this.flushing || this.destroyed) return;
    this.flushing = true;
    try {
      while (this.pendingWrite && this.sendCreditBytes > 0 && !this.destroyed) {
        const pending = this.pendingWrite;
        const remaining = pending.buffer.byteLength - pending.offset;
        if (remaining === 0) {
          this.pendingWrite = null;
          pending.callback();
          continue;
        }
        const size = Math.min(remaining, this.maxFrameBytes, this.sendCreditBytes);
        const frame = pending.buffer.subarray(pending.offset, pending.offset + size);
        this.sendCreditBytes -= size;
        await this.enqueueData(frame);
        pending.offset += size;
        if (pending.offset === pending.buffer.byteLength) {
          this.pendingWrite = null;
          pending.callback();
        }
      }
    } catch (error) {
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.flushing = false;
    }
  }

  private acceptSequence(sequence: number): boolean {
    if (sequence !== this.receiveSequence) return false;
    this.receiveSequence += 1;
    return true;
  }

  private takeSendSequence(): number {
    if (this.sendSequence > Number.MAX_SAFE_INTEGER) {
      throw new Error("Remote Web Service sequence limit exceeded");
    }
    const sequence = this.sendSequence;
    this.sendSequence += 1;
    return sequence;
  }

  private enqueueControl(frame: OutboundControlFrame): Promise<void> {
    return this.enqueueSend(
      JSON.stringify({ ...frame, sequence: this.takeSendSequence(), sessionId: this.sessionId }),
    );
  }

  private enqueueData(data: Buffer): Promise<void> {
    return this.enqueueSend(encodeDataFrame(data, this.takeSendSequence(), this.sessionDigest));
  }

  private enqueueSend(data: string | ArrayBuffer): Promise<void> {
    const operation = this.sendOperation.then(() => this.transport.send(data));
    this.sendOperation = operation.catch(() => undefined);
    return operation;
  }

  private async sendEnd(callback: (error?: Error | null) => void): Promise<void> {
    try {
      await this.enqueueControl({ type: "end" });
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private closeTransportOnce(code = 1000, reason = "Remote Web Service stream complete"): void {
    if (this.transportClosed) return;
    this.transportClosed = true;
    this.transport.close(code, reason);
  }
}
