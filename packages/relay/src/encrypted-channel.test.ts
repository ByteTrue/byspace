import { describe, it, expect, vi } from "vitest";
import {
  createClientChannel,
  createDaemonChannel,
  EncryptedChannel,
  Transport,
} from "./encrypted-channel.js";
import {
  deriveSharedKey,
  decrypt,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "./crypto.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";

/**
 * Creates a pair of connected mock transports.
 * Messages sent on one are received on the other.
 */
function createMockTransportPair(): [Transport, Transport] {
  const transportA: Transport = {
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  const transportB: Transport = {
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  // Wire them together
  (transportA.send as ReturnType<typeof vi.fn>).mockImplementation((data: string | ArrayBuffer) => {
    setTimeout(() => transportB.onmessage?.({ data, isBinary: data instanceof ArrayBuffer }), 0);
  });

  (transportB.send as ReturnType<typeof vi.fn>).mockImplementation((data: string | ArrayBuffer) => {
    setTimeout(() => transportA.onmessage?.({ data, isBinary: data instanceof ArrayBuffer }), 0);
  });

  return [transportA, transportB];
}

async function waitForAsyncDelivery(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("EncryptedChannel", () => {
  it("rejects the daemon handshake when the ready frame fails to send", async () => {
    const daemonKeyPair = generateKeyPair();
    const clientKeyPair = generateKeyPair();
    const transport: Transport = {
      send: () => Promise.reject(new Error("ready send failed")),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const channel = createDaemonChannel(transport, daemonKeyPair);

    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_hello",
        key: exportPublicKey(clientKeyPair.publicKey),
      }),
      isBinary: false,
    });

    await expect(channel).rejects.toThrow("ready send failed");
  });

  it("waits for transport send completion", async () => {
    let completeSend: (() => void) | undefined;
    const transport: Transport = {
      send: () =>
        new Promise<void>((resolve) => {
          completeSend = resolve;
        }),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const first = generateKeyPair();
    const second = generateKeyPair();
    const channel = new EncryptedChannel(
      transport,
      deriveSharedKey(first.secretKey, second.publicKey),
      {},
      { binaryCiphertext: true },
    );
    channel.setState("open");
    let completed = false;

    const sending = channel.send(new Uint8Array([1, 2, 3]).buffer).then(() => {
      completed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    completeSend?.();
    await sending;
    expect(completed).toBe(true);
  });

  it("establishes encrypted channel between daemon and client", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    // Daemon generates keypair (public key goes in QR)
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    // Start daemon waiting for client
    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);

    // Client connects (scanned QR, got daemon's public key)
    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });

    // Daemon receives hello and completes handshake
    const daemonChannel = await daemonChannelPromise;
    await clientOpened;

    expect(clientChannel.isOpen()).toBe(true);
    expect(daemonChannel.isOpen()).toBe(true);
  });

  // The Go daemon (internal/e2ee/channel.go) sends a per-session nonce in e2ee_ready and drops
  // every application frame until the client echoes it back as the first encrypted frame. A client
  // that goes straight from ready to app frames is silently unheard. This mirrors that contract.
  it("echoes the daemon challenge before any application frame", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    const challenge = "nonce-abc123";

    // Ciphertext arrives as base64 text until binaryCiphertext is negotiated, so only a payload
    // starting with "{" is plaintext handshake traffic.
    const sentToDaemon: ArrayBuffer[] = [];
    let clientPublicB64 = "";
    const transport: Transport = {
      send: (data: string | ArrayBuffer) => {
        if (data instanceof ArrayBuffer) {
          sentToDaemon.push(data);
        } else if (data.trim().startsWith("{")) {
          const parsed = JSON.parse(data) as { type: string; key?: string };
          if (parsed.type === "e2ee_hello" && parsed.key) clientPublicB64 = parsed.key;
        } else {
          sentToDaemon.push(base64ToArrayBuffer(data));
        }
        return Promise.resolve();
      },
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    const clientChannelPromise = createClientChannel(transport, daemonPubKeyB64);
    await waitForAsyncDelivery();
    expect(clientPublicB64).not.toBe("");

    // Daemon side derives the shared key and sends ready carrying the nonce.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(clientPublicB64));
    transport.onmessage?.({
      data: JSON.stringify({ type: "e2ee_ready", challenge }),
      isBinary: false,
    });

    const clientChannel = await clientChannelPromise;
    expect(clientChannel.isOpen()).toBe(true);

    // Queue an application frame; it must land after the challenge echo, not before.
    await clientChannel.send("hello-app");
    await waitForAsyncDelivery();

    expect(sentToDaemon.length).toBeGreaterThanOrEqual(2);
    const first = JSON.parse(new TextDecoder().decode(decrypt(sharedKey, sentToDaemon[0]!))) as {
      type: string;
      challenge: string;
    };
    expect(first).toEqual({ type: "e2ee_challenge", challenge });
    const second = new TextDecoder().decode(decrypt(sharedKey, sentToDaemon[1]!));
    expect(second).toBe("hello-app");
  });

  it("works against a daemon that sends no challenge", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    const sentToDaemon: ArrayBuffer[] = [];
    let clientPublicB64 = "";
    const transport: Transport = {
      send: (data: string | ArrayBuffer) => {
        if (data instanceof ArrayBuffer) {
          sentToDaemon.push(data);
        } else if (data.trim().startsWith("{")) {
          const parsed = JSON.parse(data) as { type: string; key?: string };
          if (parsed.type === "e2ee_hello" && parsed.key) clientPublicB64 = parsed.key;
        } else {
          sentToDaemon.push(base64ToArrayBuffer(data));
        }
        return Promise.resolve();
      },
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    const clientChannelPromise = createClientChannel(transport, daemonPubKeyB64);
    await waitForAsyncDelivery();

    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(clientPublicB64));
    transport.onmessage?.({
      data: JSON.stringify({ type: "e2ee_ready" }),
      isBinary: false,
    });

    const clientChannel = await clientChannelPromise;
    await clientChannel.send("hello-app");
    await waitForAsyncDelivery();

    // No challenge means the first frame is the application frame itself.
    expect(sentToDaemon.length).toBe(1);
    const first = new TextDecoder().decode(decrypt(sharedKey, sentToDaemon[0]!));
    expect(first).toBe("hello-app");
  });

  it("exchanges encrypted messages bidirectionally", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    const daemonMessages: (string | ArrayBuffer)[] = [];
    const clientMessages: (string | ArrayBuffer)[] = [];

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });

    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onmessage: (data) => clientMessages.push(data),
      onopen: () => clientOpenedResolve?.(),
    });

    const daemonChannel = await daemonChannelPromise;
    await clientOpened;

    // Send messages both directions
    await clientChannel.send("Hello from client");
    await daemonChannel.send("Hello from daemon");
    await clientChannel.send("Second message from client");

    // Wait for async delivery
    await waitForAsyncDelivery();

    expect(daemonMessages).toEqual(["Hello from client", "Second message from client"]);
    expect(clientMessages).toEqual(["Hello from daemon"]);
  });

  it("encrypted messages are opaque to transport", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);
    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });
    await daemonChannelPromise;
    await clientOpened;

    // Clear mock call history
    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();

    // Send a plaintext message
    const plaintext = "Secret message";
    await clientChannel.send(plaintext);

    // Check what was actually sent over the transport
    expect(clientTransport.send).toHaveBeenCalledTimes(1);
    const sentData = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Should be base64 string (encrypted)
    expect(typeof sentData).toBe("string");
    // Should NOT contain the plaintext
    expect(sentData).not.toContain(plaintext);
    // Should be significantly longer than plaintext (IV + auth tag overhead)
    expect(sentData.length).toBeGreaterThan(plaintext.length + 20);
  });

  it("does not throw uncaught when handshake hello retry send fails", async () => {
    vi.useFakeTimers();
    try {
      const daemonKeyPair = generateKeyPair();
      const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

      const transport: Transport = {
        send: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      let sendAttempts = 0;
      (transport.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        sendAttempts += 1;
        if (sendAttempts >= 2) {
          throw new Error("WebSocket not open (readyState=2)");
        }
      });

      const onerror = vi.fn();
      await createClientChannel(transport, daemonPubKeyB64, { onerror });

      expect(() => {
        vi.advanceTimersByTime(1000);
      }).not.toThrow();

      expect(onerror).toHaveBeenCalledTimes(1);
      expect(onerror.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((onerror.mock.calls[0][0] as Error).message).toContain("WebSocket not open");

      // Close the transport to stop retry timer.
      transport.onclose?.(1000, "closed");
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports rejected handshake hello sends", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    const transport: Transport = {
      send: () => Promise.reject(new Error("hello send failed")),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const onerror = vi.fn();

    await createClientChannel(transport, daemonPubKeyB64, { onerror });
    await Promise.resolve();

    expect(onerror).toHaveBeenCalledTimes(1);
    expect((onerror.mock.calls[0][0] as Error).message).toBe("hello send failed");
    transport.onclose?.(1000, "closed");
  });

  it("reports rejected sends while flushing the handshake backlog", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    let sendAttempts = 0;
    const transport: Transport = {
      send: () => {
        sendAttempts += 1;
        return sendAttempts === 1 ? undefined : Promise.reject(new Error("backlog send failed"));
      },
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const onerror = vi.fn();
    const channel = await createClientChannel(transport, daemonPubKeyB64, { onerror });
    await channel.send(new ArrayBuffer(8));

    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_ready",
        capabilities: { binaryCiphertext: true },
      }),
      isBinary: false,
    });
    await waitForAsyncDelivery();

    expect(onerror).toHaveBeenCalledTimes(1);
    expect((onerror.mock.calls[0][0] as Error).message).toBe("backlog send failed");
    expect(transport.close).toHaveBeenCalledWith(1011, "backlog send failed");
  });

  it("fails handshake on invalid hello", async () => {
    const [daemonTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);

    // Send invalid hello
    setTimeout(() => {
      daemonTransport.onmessage?.({ data: '{"type":"invalid"}', isBinary: false });
    }, 0);

    await expect(daemonChannelPromise).rejects.toThrow("Invalid hello message");
  });

  it("accepts duplicate hello from the same client without re-keying", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    const daemonMessages: (string | ArrayBuffer)[] = [];

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });

    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });

    await daemonChannelPromise;
    await clientOpened;

    const firstHello = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls.find(
      ([data]) => typeof data === "string" && data.includes('"type":"e2ee_hello"'),
    )?.[0];
    expect(typeof firstHello).toBe("string");

    daemonTransport.onmessage?.({ data: firstHello as string, isBinary: false });
    await waitForAsyncDelivery();

    expect(daemonTransport.close).not.toHaveBeenCalled();

    await clientChannel.send("still encrypted with original key");
    await waitForAsyncDelivery();

    expect(daemonMessages).toEqual(["still encrypted with original key"]);
  });

  it("closes an open daemon channel when a different client key sends hello", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);

    await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });

    await daemonChannelPromise;
    await clientOpened;

    const attackerKeyPair = generateKeyPair();
    const attackerHello = JSON.stringify({
      type: "e2ee_hello",
      key: exportPublicKey(attackerKeyPair.publicKey),
    });

    daemonTransport.onmessage?.({ data: attackerHello, isBinary: false });
    await waitForAsyncDelivery();

    expect(daemonTransport.close).toHaveBeenCalledWith(1008, "E2EE re-handshake key mismatch");
  });

  it("preserves ASCII-only binary frames in negotiated mode", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();
    const daemonKeyPair = generateKeyPair();
    const daemonMessages: (string | ArrayBuffer)[] = [];
    let resolveOpen: (() => void) | null = null;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });
    const clientChannel = await createClientChannel(
      clientTransport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
    );
    await daemonChannelPromise;
    await opened;

    const binary = new TextEncoder().encode("ASCII terminal output").buffer;
    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await clientChannel.send(binary);
    await waitForAsyncDelivery();

    const ciphertext = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(ciphertext).toBeInstanceOf(ArrayBuffer);
    expect((ciphertext as ArrayBuffer).byteLength).toBe(binary.byteLength + 40);
    expect(daemonMessages[0]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(daemonMessages[0] as ArrayBuffer)).toEqual(new Uint8Array(binary));
  });

  it("keeps negotiated text as base64 text frames", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();
    const daemonKeyPair = generateKeyPair();
    const daemonMessages: (string | ArrayBuffer)[] = [];
    let resolveOpen: (() => void) | null = null;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });
    const clientChannel = await createClientChannel(
      clientTransport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
    );
    await daemonChannelPromise;
    await opened;

    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await clientChannel.send("text payload");
    await waitForAsyncDelivery();

    expect(typeof (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "string",
    );
    expect(daemonMessages).toEqual(["text payload"]);
  });

  it("new client stays base64-only when an old daemon does not accept the capability", async () => {
    const daemonKeyPair = generateKeyPair();
    const clientTransport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    let resolveOpen: (() => void) | null = null;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const clientChannel = await createClientChannel(
      clientTransport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
    );

    const hello = JSON.parse(
      (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { key: string };
    expect(hello).toMatchObject({ capabilities: { binaryCiphertext: true } });
    clientTransport.onmessage?.({ data: JSON.stringify({ type: "e2ee_ready" }), isBinary: false });
    await opened;

    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await clientChannel.send(new TextEncoder().encode("legacy binary").buffer);
    expect(typeof (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "string",
    );
  });

  it("new daemon stays base64-only for an old client and drains pipelined traffic", async () => {
    const daemonKeyPair = generateKeyPair();
    const clientKeyPair = generateKeyPair();
    const daemonMessages: (string | ArrayBuffer)[] = [];
    const daemonTransport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const channelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });
    const sharedKey = deriveSharedKey(
      clientKeyPair.secretKey,
      importPublicKey(exportPublicKey(daemonKeyPair.publicKey)),
    );
    daemonTransport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_hello",
        key: exportPublicKey(clientKeyPair.publicKey),
      }),
      isBinary: false,
    });
    daemonTransport.onmessage?.({
      data: arrayBufferToBase64(encrypt(sharedKey, "pipelined legacy text")),
      isBinary: false,
    });

    const daemonChannel = await channelPromise;
    await waitForAsyncDelivery();
    expect(daemonMessages).toEqual(["pipelined legacy text"]);
    expect(
      JSON.parse((daemonTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]),
    ).toEqual({
      type: "e2ee_ready",
    });

    (daemonTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await daemonChannel.send(new Uint8Array([1, 2, 3]).buffer);
    expect(typeof (daemonTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "string",
    );
  });
});

describe("challenge echo ordering", () => {
  it("sends the echo before anything an open listener writes", async () => {
    // The daemon discards every frame before the nonce, so a listener that writes from onopen used
    // to lose its first frames and leave the connection permanently unopened.
    const clientKeyPair = generateKeyPair();
    const daemonKeyPair = generateKeyPair();
    const sharedKey = deriveSharedKey(
      clientKeyPair.secretKey,
      importPublicKey(exportPublicKey(daemonKeyPair.publicKey)),
    );
    const sent: ArrayBuffer[] = [];
    const transport: Transport = {
      send: (data: string | ArrayBuffer) => {
        if (data instanceof ArrayBuffer) sent.push(data);
        else if (!data.trim().startsWith("{")) sent.push(base64ToArrayBuffer(data));
        return Promise.resolve();
      },
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    let channel: EncryptedChannel | null = null;
    channel = new EncryptedChannel(
      transport,
      sharedKey,
      { onopen: () => void channel?.send("from-onopen") },
      {},
    );

    transport.onmessage?.({
      data: JSON.stringify({ type: "e2ee_ready", challenge: "nonce-open-order" }),
      isBinary: false,
    });
    await waitForAsyncDelivery();

    expect(sent.length).toBe(2);
    const first = JSON.parse(new TextDecoder().decode(decrypt(sharedKey, sent[0]!)));
    expect(first).toEqual({ type: "e2ee_challenge", challenge: "nonce-open-order" });
    expect(new TextDecoder().decode(decrypt(sharedKey, sent[1]!))).toBe("from-onopen");
  });
});
