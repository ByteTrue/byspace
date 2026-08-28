import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  FileBeginMetadataSchema,
  FileTransferOpcode,
  TerminalStreamOpcode,
  decodeBinaryFrame,
  decodeTerminalResizePayload,
  encodeFileTransferFrame,
  encodeTerminalResizePayload,
  encodeTerminalStreamFrame,
} from "./binary-frames/index.js";
import {
  AgentCreatedStatusPayloadSchema,
  ServerInfoStatusPayloadSchema,
  WSInboundMessageSchema,
  WSOutboundMessageSchema,
} from "./messages.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/protocol/v1");

type JsonFixture = { name: string; value: unknown };

type BinaryFixture =
  | {
      name: string;
      kind: "terminal";
      opcode: "output";
      slot: number;
      payloadHex: string;
      wireHex: string;
    }
  | {
      name: string;
      kind: "terminal_resize";
      slot: number;
      resize: { rows: number; cols: number; intent: "claim" | "update" };
      wireHex: string;
    }
  | {
      name: string;
      kind: "file_begin";
      requestId: string;
      metadata: unknown;
      wireHex: string;
    }
  | {
      name: string;
      kind: "file_chunk";
      requestId: string;
      payloadHex: string;
      wireHex: string;
    }
  | {
      name: string;
      kind: "file_end";
      requestId: string;
      wireHex: string;
    };

interface BinaryFixtureFile {
  valid: BinaryFixture[];
  invalid: Array<{ name: string; wireHex: string }>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonFixtures(relativePath: string): JsonFixture[] {
  const directory = join(fixtureRoot, relativePath);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, value: readJson(join(directory, name)) }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateKnownStatusPayload(value: unknown): void {
  if (!isRecord(value) || value.type !== "session" || !isRecord(value.message)) return;
  const message = value.message;
  if (message.type !== "status" || !isRecord(message.payload)) return;

  if (message.payload.status === "server_info") {
    ServerInfoStatusPayloadSchema.parse(message.payload);
  } else if (message.payload.status === "agent_created") {
    AgentCreatedStatusPayloadSchema.parse(message.payload);
  }
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Invalid hex fixture: ${hex}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeBinaryFixture(fixture: BinaryFixture): Uint8Array {
  switch (fixture.kind) {
    case "terminal":
      return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: fixture.slot,
        payload: fromHex(fixture.payloadHex),
      });
    case "terminal_resize":
      return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Resize,
        slot: fixture.slot,
        payload: encodeTerminalResizePayload(fixture.resize),
      });
    case "file_begin":
      return encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: fixture.requestId,
        metadata: FileBeginMetadataSchema.parse(fixture.metadata),
      });
    case "file_chunk":
      return encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileChunk,
        requestId: fixture.requestId,
        payload: fromHex(fixture.payloadHex),
      });
    case "file_end":
      return encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileEnd,
        requestId: fixture.requestId,
      });
  }
}

function reencodeBinaryWire(wire: Uint8Array): Uint8Array {
  const decoded = decodeBinaryFrame(wire);
  if (!decoded) throw new Error("Fixture did not decode");

  if (decoded.kind === "terminal") {
    return encodeTerminalStreamFrame(decoded.frame);
  }

  switch (decoded.frame.opcode) {
    case FileTransferOpcode.FileBegin:
      return encodeFileTransferFrame({
        opcode: decoded.frame.opcode,
        requestId: decoded.frame.requestId,
        metadata: decoded.frame.metadata,
      });
    case FileTransferOpcode.FileChunk:
      return encodeFileTransferFrame({
        opcode: decoded.frame.opcode,
        requestId: decoded.frame.requestId,
        payload: decoded.frame.payload,
      });
    case FileTransferOpcode.FileEnd:
      return encodeFileTransferFrame({
        opcode: decoded.frame.opcode,
        requestId: decoded.frame.requestId,
      });
  }
}

const validClientFixtures = readJsonFixtures("valid/client-to-daemon");
const validServerFixtures = readJsonFixtures("valid/daemon-to-client");
const compatibleClientFixtures = readJsonFixtures("compat/client-to-daemon");
const compatibleServerFixtures = readJsonFixtures("compat/daemon-to-client");
const invalidClientFixtures = readJsonFixtures("invalid/client-to-daemon");
const binaryFixtures = readJson(join(fixtureRoot, "binary.json")) as BinaryFixtureFile;

describe("shared JSON protocol fixtures", () => {
  test.each(validClientFixtures)("accepts and round-trips client fixture $name", ({ value }) => {
    const parsed = WSInboundMessageSchema.parse(value);
    const encoded = JSON.parse(JSON.stringify(parsed));
    expect(encoded).toEqual(value);
    expect(WSInboundMessageSchema.parse(encoded)).toEqual(parsed);
  });

  test.each(validServerFixtures)("accepts and round-trips server fixture $name", ({ value }) => {
    const parsed = WSOutboundMessageSchema.parse(value);
    validateKnownStatusPayload(value);
    const encoded = JSON.parse(JSON.stringify(parsed));
    expect(encoded).toEqual(value);
    expect(WSOutboundMessageSchema.parse(encoded)).toEqual(parsed);
  });

  test.each(compatibleClientFixtures)(
    "accepts client fixture $name with unknown fields",
    ({ value }) => {
      const parsed = WSInboundMessageSchema.parse(value);
      expect(parsed.type).toBe("session");
      expect(parsed).not.toHaveProperty("futureEnvelopeField");
      if (parsed.type === "session") {
        expect(parsed.message).not.toHaveProperty("futureMessageField");
      }
    },
  );

  test.each(compatibleServerFixtures)(
    "accepts server fixture $name with unknown fields",
    ({ value }) => {
      expect(WSOutboundMessageSchema.safeParse(value).success).toBe(true);
    },
  );

  test.each(invalidClientFixtures)("rejects invalid client fixture $name", ({ value }) => {
    expect(WSInboundMessageSchema.safeParse(value).success).toBe(false);
  });
});

describe("shared binary protocol fixtures", () => {
  test.each(binaryFixtures.valid)("matches and round-trips $name byte-for-byte", (fixture) => {
    const wire = fromHex(fixture.wireHex);
    expect(toHex(encodeBinaryFixture(fixture))).toBe(fixture.wireHex);
    expect(toHex(reencodeBinaryWire(wire))).toBe(fixture.wireHex);

    if (fixture.kind === "terminal_resize") {
      const decoded = decodeBinaryFrame(wire);
      expect(decoded?.kind).toBe("terminal");
      if (decoded?.kind === "terminal") {
        expect(decodeTerminalResizePayload(decoded.frame.payload)).toEqual(fixture.resize);
      }
    }
  });

  test.each(binaryFixtures.invalid)("rejects invalid binary fixture $name", ({ wireHex }) => {
    expect(decodeBinaryFrame(fromHex(wireHex))).toBeNull();
  });
});
