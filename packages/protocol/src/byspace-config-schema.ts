import { z } from "zod";

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const BySpaceLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const BySpaceScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const BySpaceWorktreeConfigRawSchema = z
  .object({
    setup: BySpaceLifecycleCommandRawSchema.optional(),
    teardown: BySpaceLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
  })
  .passthrough();

export const BySpaceMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const BySpaceMetadataGenerationSchema = z
  .object({
    title: BySpaceMetadataGenerationEntrySchema.optional(),
    branchName: BySpaceMetadataGenerationEntrySchema.optional(),
    commitMessage: BySpaceMetadataGenerationEntrySchema.optional(),
    pullRequest: BySpaceMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy byspace.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const BySpaceConfigRawSchema = z
  .object({
    worktree: BySpaceWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), BySpaceScriptEntryRawSchema).optional(),
    metadataGeneration: BySpaceMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = BySpaceWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = BySpaceScriptEntryRawSchema.catch({});

export const BySpaceConfigSchema = BySpaceConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: BySpaceMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const BySpaceConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: BySpaceConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type BySpaceScriptEntryRaw = z.infer<typeof BySpaceScriptEntryRawSchema>;
export type BySpaceMetadataGenerationEntry = z.infer<typeof BySpaceMetadataGenerationEntrySchema>;
export type BySpaceMetadataGeneration = z.infer<typeof BySpaceMetadataGenerationSchema>;
export type BySpaceConfigRaw = z.infer<typeof BySpaceConfigRawSchema>;
export type BySpaceConfig = z.infer<typeof BySpaceConfigSchema>;
export type BySpaceConfigRevision = z.infer<typeof BySpaceConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
