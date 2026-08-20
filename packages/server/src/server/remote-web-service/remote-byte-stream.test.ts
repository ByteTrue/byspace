import { describe, expect, it } from "vitest";
import { finished } from "node:stream/promises";
import { RemoteByteStream, type RemoteByteStreamTransport } from "./remote-byte-stream.js";

function createPair(options?: { initialCreditBytes?: number; maxFrameBytes?: number }) {
  let left!: RemoteByteStream;
  let right!: RemoteByteStream;
  let leftClosed = false;
  let rightClosed = false;

  const transport = (
    deliver: (data: string | ArrayBuffer) => void,
    close: (code?: number, reason?: string) => void,
  ) =>
    ({
      send: async (data) => deliver(data),
      close,
    }) satisfies RemoteByteStreamTransport;

  left = new RemoteByteStream(
    transport(
      (data) => queueMicrotask(() => right.receive(data)),
      (code, reason) => {
        leftClosed = true;
        queueMicrotask(() => right.receiveClose(code, reason));
      },
    ),
    options,
  );
  right = new RemoteByteStream(
    transport(
      (data) => queueMicrotask(() => left.receive(data)),
      (code, reason) => {
        rightClosed = true;
        queueMicrotask(() => left.receiveClose(code, reason));
      },
    ),
    options,
  );

  return {
    left,
    right,
    isLeftClosed: () => leftClosed,
    isRightClosed: () => rightClosed,
  };
}

async function collect(stream: RemoteByteStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("RemoteByteStream", () => {
  it("transfers bytes in both directions and propagates half-close", async () => {
    const pair = createPair({ initialCreditBytes: 8, maxFrameBytes: 3 });
    const leftReceived = collect(pair.left);
    const rightReceived = collect(pair.right);

    pair.left.end(Buffer.from("request"));
    pair.right.end(Buffer.from("response"));

    const [leftBytes, rightBytes] = await Promise.all([leftReceived, rightReceived]);
    await Promise.all([finished(pair.left), finished(pair.right)]);
    expect(leftBytes).toEqual(Buffer.from("response"));
    expect(rightBytes).toEqual(Buffer.from("request"));
    expect(pair.isLeftClosed()).toBe(true);
    expect(pair.isRightClosed()).toBe(true);
  });

  it("does not complete a write beyond the receiver credit until the receiver drains", async () => {
    const pair = createPair({ initialCreditBytes: 4, maxFrameBytes: 2 });
    let completed = false;
    pair.left.write(Buffer.from("abcdef"), () => {
      completed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(completed).toBe(false);

    const received = pair.right.read(4);
    expect(Buffer.from(received)).toEqual(Buffer.from("abcd"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(completed).toBe(true);

    pair.left.end();
    pair.right.resume();
    pair.right.end();
    pair.left.resume();
    await Promise.all([finished(pair.left), finished(pair.right)]);
  });

  it("keeps the response direction open after the request direction ends", async () => {
    const pair = createPair();
    const request = collect(pair.right);
    const response = collect(pair.left);

    pair.left.end("request");
    expect(await request).toEqual(Buffer.from("request"));
    pair.right.write("first");
    await new Promise((resolve) => setTimeout(resolve, 5));
    pair.right.end("second");

    expect(await response).toEqual(Buffer.from("firstsecond"));
  });

  it("fails both sides when one transport closes unexpectedly", async () => {
    const pair = createPair();
    const leftError = new Promise<Error>((resolve) => pair.left.once("error", resolve));
    const rightError = new Promise<Error>((resolve) => pair.right.once("error", resolve));

    pair.left.receiveClose(1006, "network lost");

    await expect(leftError).resolves.toMatchObject({ message: "network lost" });
    await expect(rightError).resolves.toBeInstanceOf(Error);
  });

  it("rejects malformed control frames", async () => {
    const pair = createPair();
    const error = new Promise<Error>((resolve) => pair.left.once("error", resolve));
    pair.right.on("error", () => undefined);

    pair.left.receive('{"type":"window","bytes":0}');

    await expect(error).resolves.toMatchObject({ message: "Invalid Remote Web Service frame" });
  });
});
