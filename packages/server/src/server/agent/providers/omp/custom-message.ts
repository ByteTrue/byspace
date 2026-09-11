import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type { OmpAgentMessage } from "./rpc-types.js";

type OmpCustomMessage = Extract<OmpAgentMessage, { role: "custom" }>;

export function shouldDisplayOmpCustomMessage(message: OmpCustomMessage): boolean {
  return Reflect.get(message, "display") !== false;
}

export function readOmpCustomType(message: OmpCustomMessage): string {
  const customType = Reflect.get(message, "customType");
  return typeof customType === "string" && customType ? customType : "custom";
}

const CUSTOM_MESSAGE_DETAILS_MAX_BYTES = 64 * 1024;

/**
 * Custom-message details are auxiliary JSON attached to every timeline row, so
 * non-serializable values and oversized payloads are dropped rather than failing
 * the item — the content text still delivers.
 */
export function readOmpCustomDetails(message: OmpCustomMessage): JsonValue | undefined {
  const details: unknown = Reflect.get(message, "details");
  if (details === undefined || details === null) return undefined;
  let encoded: string;
  try {
    encoded = JSON.stringify(details);
  } catch {
    return undefined;
  }
  if (
    encoded === undefined ||
    Buffer.byteLength(encoded, "utf8") > CUSTOM_MESSAGE_DETAILS_MAX_BYTES
  ) {
    return undefined;
  }
  return JSON.parse(encoded) as JsonValue;
}
