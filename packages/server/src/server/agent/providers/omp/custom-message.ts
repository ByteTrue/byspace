import type { OmpAgentMessage } from "./rpc-types.js";

type OmpCustomMessage = Extract<OmpAgentMessage, { role: "custom" }>;

export function shouldDisplayOmpCustomMessage(message: OmpCustomMessage): boolean {
  return Reflect.get(message, "display") !== false;
}

export function readOmpCustomType(message: OmpCustomMessage): string {
  const customType = Reflect.get(message, "customType");
  return typeof customType === "string" && customType ? customType : "custom";
}
