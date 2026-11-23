import { z } from "zod";
import type { ParsedDiffFile } from "../messages.js";

// Diff frames carry one revision of a comparison. Begin and End are JSON control frames because
// they are schema-checked like every other daemon message; Bodies is binary so file text is never
// escaped or base64'd. Layouts are design.md D10.
export const DiffOpcode = {
  Begin: 0x30,
  Bodies: 0x31,
  End: 0x32,
} as const;

export type DiffOpcode = (typeof DiffOpcode)[keyof typeof DiffOpcode];

export const DiffResolvedSchema = z.object({
  baseSha: z.string(),
  headSha: z.string(),
  mergeBaseSha: z.string(),
});

// The error code is the protocol's checkout error enum; frames and JSON payloads share it.
export const DiffErrorSchema = z.object({
  code: z.enum(["UNKNOWN", "NOT_GIT_REPO", "NOT_ALLOWED", "MERGE_CONFLICT"]),
  message: z.string(),
});

export const DiffBeginHeaderSchema = z.object({
  revision: z.number().int().nonnegative(),
  cwd: z.string(),
  compare: z.object({
    mode: z.enum(["uncommitted", "base"]),
    baseRef: z.string().optional(),
    ignoreWhitespace: z.boolean().optional(),
  }),
  resolved: DiffResolvedSchema,
  entries: z.array(z.string()),
  error: DiffErrorSchema.nullable(),
});

export const DiffEndTrailerSchema = z.object({
  revision: z.number().int().nonnegative(),
  omitted: z.number().int().nonnegative(),
  diffTooLarge: z.boolean(),
  error: DiffErrorSchema.nullable(),
});

export interface DiffBegin {
  opcode: typeof DiffOpcode.Begin;
  subscriptionId: string;
  header: z.infer<typeof DiffBeginHeaderSchema>;
}

export interface DiffBodyFile {
  path: string;
  body: Uint8Array;
}

export interface DiffBodies {
  opcode: typeof DiffOpcode.Bodies;
  subscriptionId: string;
  files: DiffBodyFile[];
}

export interface DiffEnd {
  opcode: typeof DiffOpcode.End;
  subscriptionId: string;
  trailer: z.infer<typeof DiffEndTrailerSchema>;
}

export type DiffFrame = DiffBegin | DiffBodies | DiffEnd;

export type DiffFrameInput =
  | {
      opcode: typeof DiffOpcode.Begin;
      subscriptionId: string;
      header: z.infer<typeof DiffBeginHeaderSchema>;
    }
  | { opcode: typeof DiffOpcode.Bodies; subscriptionId: string; files: DiffBodyFile[] }
  | {
      opcode: typeof DiffOpcode.End;
      subscriptionId: string;
      trailer: z.infer<typeof DiffEndTrailerSchema>;
    };

export function encodeDiffFrame(input: DiffFrameInput): Uint8Array {
  const id = encodeSubscriptionId(input.subscriptionId);
  if (input.opcode === DiffOpcode.Bodies) {
    const files = input.files.map((file) => ({
      path: new TextEncoder().encode(file.path),
      body: file.body,
    }));
    for (const file of files) {
      if (file.path.byteLength > 0xffff) {
        throw new RangeError("Diff body path is too long");
      }
    }
    const size = files.reduce(
      (total, file) => total + 2 + file.path.byteLength + 4 + file.body.byteLength,
      0,
    );
    const bytes = new Uint8Array(2 + id.byteLength + 4 + size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    bytes[0] = input.opcode;
    bytes[1] = id.byteLength;
    bytes.set(id, 2);
    let offset = 2 + id.byteLength;
    view.setUint32(offset, files.length);
    offset += 4;
    for (const file of files) {
      view.setUint16(offset, file.path.byteLength);
      bytes.set(file.path, offset + 2);
      offset += 2 + file.path.byteLength;
      view.setUint32(offset, file.body.byteLength);
      bytes.set(file.body, offset + 4);
      offset += 4 + file.body.byteLength;
    }
    return bytes;
  }

  const json = new TextEncoder().encode(
    JSON.stringify(input.opcode === DiffOpcode.Begin ? input.header : input.trailer),
  );
  const bytes = new Uint8Array(2 + id.byteLength + json.byteLength);
  bytes[0] = input.opcode;
  bytes[1] = id.byteLength;
  bytes.set(id, 2);
  bytes.set(json, 2 + id.byteLength);
  return bytes;
}

export function decodeDiffFrame(bytes: Uint8Array): DiffFrame | null {
  if (bytes.byteLength < 2) {
    return null;
  }
  const opcode = bytes[0];
  if (opcode !== DiffOpcode.Begin && opcode !== DiffOpcode.Bodies && opcode !== DiffOpcode.End) {
    return null;
  }
  const idLength = bytes[1];
  if (idLength === 0 || idLength > bytes.byteLength - 2) {
    return null;
  }
  const subscriptionId = new TextDecoder().decode(bytes.subarray(2, 2 + idLength));
  const body = bytes.subarray(2 + idLength);

  if (opcode === DiffOpcode.Bodies) {
    if (body.byteLength < 4) {
      return null;
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const count = view.getUint32(0);
    let offset = 4;
    const files: DiffBodyFile[] = [];
    for (let index = 0; index < count; index += 1) {
      if (offset + 2 > body.byteLength) {
        return null;
      }
      const pathLength = view.getUint16(offset);
      offset += 2;
      if (offset + pathLength + 4 > body.byteLength) {
        return null;
      }
      const path = new TextDecoder().decode(body.subarray(offset, offset + pathLength));
      offset += pathLength;
      const bodyLength = view.getUint32(offset);
      offset += 4;
      if (offset + bodyLength > body.byteLength) {
        return null;
      }
      files.push({ path, body: body.subarray(offset, offset + bodyLength) });
      offset += bodyLength;
    }
    return offset === body.byteLength ? { opcode, subscriptionId, files } : null;
  }

  const parsed = decodeJson(body);
  if (opcode === DiffOpcode.Begin) {
    const result = DiffBeginHeaderSchema.safeParse(parsed);
    return result.success ? { opcode, subscriptionId, header: result.data } : null;
  }
  const result = DiffEndTrailerSchema.safeParse(parsed);
  return result.success ? { opcode, subscriptionId, trailer: result.data } : null;
}

function encodeSubscriptionId(subscriptionId: string): Uint8Array {
  const bytes = new TextEncoder().encode(subscriptionId);
  if (bytes.byteLength === 0) {
    throw new RangeError("Diff subscriptionId is required");
  }
  if (bytes.byteLength > 0xff) {
    throw new RangeError("Diff subscriptionId is too long");
  }
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// A body file is the parsed diff of one path, serialized the way the JSON payload carries it.
export function serializeDiffBody(file: ParsedDiffFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}
