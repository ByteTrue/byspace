import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  FileTransferOpcode,
  type FileTransferFrame,
} from "@bytetrue/byspace-protocol/binary-frames/index";
import {
  WorkspaceFilesSession,
  type WorkspaceFilesSessionHost,
  type WorkspaceFilesSessionOptions,
} from "./workspace-files-session.js";
import { DownloadTokenStore } from "../../file-download/token-store.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function makeSubsystem(
  options: {
    hasBinaryChannel?: boolean;
    fileObserver?: WorkspaceFilesSessionOptions["fileObserver"];
    emitBinary?: (frame: Uint8Array) => Promise<void> | void;
  } = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const binary: Uint8Array[] = [];
  let hasBinary = options.hasBinaryChannel ?? false;
  const host: WorkspaceFilesSessionHost = {
    emit: (msg) => emitted.push(msg),
    emitBinary: async (frame) => {
      binary.push(frame);
      await options.emitBinary?.(frame);
    },
    hasBinaryChannel: () => hasBinary,
  };
  const byspaceHome = makeDir("workspace-files-home-");
  const subsystem = new WorkspaceFilesSession({
    host,
    downloadTokenStore: new DownloadTokenStore({ ttlMs: 60_000 }),
    byspaceHome,
    logger: pino({ level: "silent" }),
    fileObserver: options.fileObserver,
  });
  return {
    subsystem,
    emitted,
    binary,
    byspaceHome,
    setHasBinary: (value: boolean) => {
      hasBinary = value;
    },
  };
}

function uploadFrame(args: Parameters<typeof encodeFileTransferFrame>[0]): FileTransferFrame {
  const frame = decodeFileTransferFrame(encodeFileTransferFrame(args));
  if (!frame) {
    throw new Error("Expected a file transfer frame");
  }
  return frame;
}

describe("WorkspaceFilesSession", () => {
  test("disposes a subscription that finishes setup after the session closes", async () => {
    let finishSubscribe!: (value: {
      initial: {
        status: "ready";
        cwd: string;
        path: string;
        size: number;
        modifiedAt: string;
        revision: string;
      };
      unsubscribe: () => void;
    }) => void;
    let unsubscribeCount = 0;
    const fileObserver: NonNullable<WorkspaceFilesSessionOptions["fileObserver"]> = {
      subscribe: () =>
        new Promise((resolve) => {
          finishSubscribe = resolve;
        }),
    };
    const { subsystem, emitted } = makeSubsystem({ fileObserver });
    const pending = subsystem.handleFileSubscribeRequest({
      type: "fs.file.subscribe.request",
      subscriptionId: "sub-late",
      cwd: "/workspace",
      path: "file.txt",
      requestId: "req-late",
    });

    subsystem.dispose();
    finishSubscribe({
      initial: {
        status: "ready",
        cwd: "/workspace",
        path: "file.txt",
        size: 1,
        modifiedAt: "2026-07-24T00:00:00.000Z",
        revision: "revision-1",
      },
      unsubscribe: () => {
        unsubscribeCount += 1;
      },
    });
    await pending;

    expect(unsubscribeCount).toBe(1);
    expect(emitted).toEqual([]);
  });

  test("unsubscribes a superseded in-flight subscription with the same id", async () => {
    const completions: Array<
      (value: {
        initial: {
          status: "ready";
          cwd: string;
          path: string;
          size: number;
          modifiedAt: string;
          revision: string;
        };
        unsubscribe: () => void;
      }) => void
    > = [];
    let unsubscribeCount = 0;
    const fileObserver: NonNullable<WorkspaceFilesSessionOptions["fileObserver"]> = {
      subscribe: () =>
        new Promise((resolve) => {
          completions.push(resolve);
        }),
    };
    const { subsystem, emitted } = makeSubsystem({ fileObserver });
    const request = (requestId: string) =>
      subsystem.handleFileSubscribeRequest({
        type: "fs.file.subscribe.request",
        subscriptionId: "sub-shared",
        cwd: "/workspace",
        path: "file.txt",
        requestId,
      });
    const first = request("req-first");
    const second = request("req-second");
    const result = (revision: string) => ({
      initial: {
        status: "ready" as const,
        cwd: "/workspace",
        path: "file.txt",
        size: 1,
        modifiedAt: "2026-07-24T00:00:00.000Z",
        revision,
      },
      unsubscribe: () => {
        unsubscribeCount += 1;
      },
    });

    completions[0]?.(result("revision-1"));
    completions[1]?.(result("revision-2"));
    await Promise.all([first, second]);
    subsystem.dispose();

    expect(unsubscribeCount).toBe(2);
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "fs.file.subscribe.response",
        payload: expect.objectContaining({ requestId: "req-first" }),
      }),
      expect.objectContaining({
        type: "fs.file.subscribe.response",
        payload: expect.objectContaining({ requestId: "req-second" }),
      }),
    ]);
  });

  test("releases subscription ids after normal unsubscribe churn", async () => {
    const fileObserver: NonNullable<WorkspaceFilesSessionOptions["fileObserver"]> = {
      subscribe: async ({ cwd, path }) => ({
        initial: {
          status: "ready" as const,
          cwd,
          path,
          size: 1,
          modifiedAt: "2026-07-24T00:00:00.000Z",
          revision: "revision-1",
        },
        unsubscribe: () => {},
      }),
    };
    const { subsystem, emitted } = makeSubsystem({ fileObserver });

    for (let index = 0; index < 200; index += 1) {
      const subscriptionId = `sub-${index}`;
      await subsystem.handleFileSubscribeRequest({
        type: "fs.file.subscribe.request",
        subscriptionId,
        cwd: "/workspace",
        path: `file-${index}.txt`,
        requestId: `req-sub-${index}`,
      });
      subsystem.handleFileUnsubscribeRequest({
        type: "fs.file.unsubscribe.request",
        subscriptionId,
        requestId: `req-unsub-${index}`,
      });
    }

    expect(
      emitted.some(
        (message) =>
          message.type === "fs.file.subscribe.response" &&
          message.payload.initial.status === "error" &&
          message.payload.initial.error === "Too many active file subscriptions",
      ),
    ).toBe(false);
  });

  test("caps pending file subscriptions per session", async () => {
    const fileObserver: NonNullable<WorkspaceFilesSessionOptions["fileObserver"]> = {
      subscribe: () => new Promise(() => {}),
    };
    const { subsystem, emitted } = makeSubsystem({ fileObserver });

    for (let index = 0; index < 128; index += 1) {
      void subsystem.handleFileSubscribeRequest({
        type: "fs.file.subscribe.request",
        subscriptionId: `sub-${index}`,
        cwd: "/workspace",
        path: `file-${index}.txt`,
        requestId: `req-${index}`,
      });
    }
    await subsystem.handleFileSubscribeRequest({
      type: "fs.file.subscribe.request",
      subscriptionId: "sub-over-limit",
      cwd: "/workspace",
      path: "overflow.txt",
      requestId: "req-over-limit",
    });

    expect(emitted.at(-1)).toEqual({
      type: "fs.file.subscribe.response",
      payload: expect.objectContaining({
        requestId: "req-over-limit",
        initial: expect.objectContaining({
          status: "error",
          error: "Too many active file subscriptions",
        }),
      }),
    });
    subsystem.dispose();
  });

  test("lists directory entries", async () => {
    const cwd = makeDir("workspace-files-list-");
    writeFileSync(join(cwd, "a.txt"), "alpha");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-list",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.directory).not.toBeNull();
  });

  test("reads file content inline when the client has no binary channel", async () => {
    const cwd = makeDir("workspace-files-read-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: false });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-read",
      acceptBinary: true,
    });

    expect(binary).toEqual([]);
    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_explorer_response") {
      throw new Error(`expected file_explorer_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file).not.toBeNull();
  });

  test("streams binary frames when the client accepts binary and has a channel", async () => {
    const cwd = makeDir("workspace-files-binary-");
    writeFileSync(join(cwd, "notes.txt"), "hello world");
    const { subsystem, emitted, binary } = makeSubsystem({ hasBinaryChannel: true });

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "notes.txt",
      mode: "file",
      requestId: "req-binary",
      acceptBinary: true,
    });

    expect(emitted).toEqual([]);
    expect(binary).toHaveLength(3);
    const opcodes = binary.map((frame) => decodeFileTransferFrame(frame)?.opcode);
    expect(opcodes).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
      FileTransferOpcode.FileEnd,
    ]);
  });

  test("streams a real file larger than the socket limit as paced ordered chunks", async () => {
    const cwd = makeDir("workspace-files-large-binary-");
    const fileBytes = Buffer.alloc(8 * 1024 * 1024 + 123);
    for (let index = 0; index < fileBytes.length; index += 1) {
      fileBytes[index] = index % 251;
    }
    writeFileSync(join(cwd, "large.bin"), fileBytes);

    let releaseFirstChunk: (() => void) | undefined;
    const firstChunkSent = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    let chunkSends = 0;
    const { subsystem, emitted, binary } = makeSubsystem({
      hasBinaryChannel: true,
      emitBinary: async (frame) => {
        if (decodeFileTransferFrame(frame)?.opcode !== FileTransferOpcode.FileChunk) return;
        chunkSends += 1;
        if (chunkSends === 1) await firstChunkSent;
      },
    });

    const transfer = subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: "large.bin",
      mode: "file",
      requestId: "req-large-binary",
      acceptBinary: true,
    });

    await expect.poll(() => chunkSends).toBe(1);
    expect(binary.map((frame) => decodeFileTransferFrame(frame)?.opcode)).toEqual([
      FileTransferOpcode.FileBegin,
      FileTransferOpcode.FileChunk,
    ]);

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd,
      path: ".",
      mode: "list",
      requestId: "req-unrelated-list",
    });
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "file_explorer_response",
        payload: expect.objectContaining({ requestId: "req-unrelated-list", error: null }),
      }),
    ]);

    releaseFirstChunk?.();
    await transfer;

    const frames = binary.map((frame) => decodeFileTransferFrame(frame));
    const chunks = frames.flatMap((frame) =>
      frame?.opcode === FileTransferOpcode.FileChunk ? [frame.payload] : [],
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteLength <= 256 * 1024)).toBe(true);
    expect(
      Buffer.compare(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), fileBytes),
    ).toBe(0);
    expect(frames.at(0)?.opcode).toBe(FileTransferOpcode.FileBegin);
    expect(frames.at(-1)?.opcode).toBe(FileTransferOpcode.FileEnd);
    expect(emitted).toHaveLength(1);
  }, 30_000);

  test("rejects an empty file-explorer cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileExplorerRequest({
      type: "file_explorer_request",
      cwd: "  ",
      path: ".",
      mode: "list",
      requestId: "req-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_explorer_response",
        payload: expect.objectContaining({
          error: "cwd is required",
          directory: null,
          file: null,
          requestId: "req-empty",
        }),
      },
    ]);
  });

  test("issues a download token for a real file", async () => {
    const cwd = makeDir("workspace-files-token-");
    writeFileSync(join(cwd, "report.txt"), "hello world");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd,
      path: "report.txt",
      requestId: "req-token",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "file_download_token_response") {
      throw new Error(`expected file_download_token_response, got ${message.type}`);
    }
    expect(message.payload.error).toBeNull();
    expect(typeof message.payload.token).toBe("string");
    expect(message.payload.fileName).toBe("report.txt");
    expect(message.payload.size).toBe(11);
  });

  test("rejects an empty download-token cwd with an error envelope", async () => {
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleFileDownloadTokenRequest({
      type: "file_download_token_request",
      cwd: "",
      path: "report.txt",
      requestId: "req-token-empty",
    });

    expect(emitted).toEqual([
      {
        type: "file_download_token_response",
        payload: expect.objectContaining({
          token: null,
          error: "cwd is required",
          requestId: "req-token-empty",
        }),
      },
    ]);
  });

  test("responds to a project icon request", async () => {
    const cwd = makeDir("workspace-files-icon-");
    const { subsystem, emitted } = makeSubsystem();

    await subsystem.handleProjectIconRequest({
      type: "project_icon_request",
      cwd,
      requestId: "req-icon",
    });

    expect(emitted).toHaveLength(1);
    const message = emitted[0];
    if (message.type !== "project_icon_response") {
      throw new Error(`expected project_icon_response, got ${message.type}`);
    }
    expect(message.payload.cwd).toBe(cwd);
    expect(message.payload.error).toBeNull();
  });

  test("round-trips an upload through transfer frames", async () => {
    const { subsystem, emitted, byspaceHome } = makeSubsystem();

    subsystem.handleFileUploadRequest({
      type: "file.upload.request",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 11,
      modifiedAt: "2026-05-02T00:00:00.000Z",
      requestId: "req-upload",
    });
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: "req-upload",
        metadata: {
          mime: "text/plain",
          size: 11,
          encoding: "binary",
          modifiedAt: "2026-05-02T00:00:00.000Z",
          fileName: "notes.txt",
        },
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: "req-upload",
        payload: new TextEncoder().encode("hello world"),
      }),
    );
    await subsystem.handleFileTransferFrame(
      uploadFrame({ opcode: FileTransferOpcode.FileEnd, requestId: "req-upload" }),
    );

    const message = emitted.find((entry) => entry.type === "file.upload.response");
    if (message?.type !== "file.upload.response") {
      throw new Error("expected a file.upload.response message");
    }
    expect(message.payload.error).toBeNull();
    expect(message.payload.file?.fileName).toBe("notes.txt");
    expect(
      readFileSync(join(byspaceHome, "uploads", "upload_req-upload", "notes.txt"), "utf8"),
    ).toBe("hello world");
  });
});
