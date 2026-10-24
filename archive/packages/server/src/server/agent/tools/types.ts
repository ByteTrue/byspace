import type { z } from "zod";
import type { ProviderBySpaceToolsPolicy } from "@bytetrue/protocol/provider-config";

export interface BySpaceToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: BySpaceToolResult) => void;
}

export interface BySpaceToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface BySpaceToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface BySpaceToolDefinition extends BySpaceToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: BySpaceToolExecutionContext) => Promise<BySpaceToolResult>;
}

export interface BySpaceToolCatalog {
  tools: ReadonlyMap<string, BySpaceToolDefinition>;
  getTool(name: string): BySpaceToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: BySpaceToolExecutionContext,
  ): Promise<BySpaceToolResult>;
}

export interface BySpaceToolRuntimeContext {
  callerAgentId?: string;
  byspaceToolPolicy?: ProviderBySpaceToolsPolicy;
}

export type BySpaceToolCatalogFactory = (
  context: BySpaceToolRuntimeContext,
) => BySpaceToolCatalog | Promise<BySpaceToolCatalog>;
