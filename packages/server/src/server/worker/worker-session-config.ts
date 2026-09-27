/**
 * Wiring a worker to a runtime session.
 *
 * A worker task is one agent session. The only thing that distinguishes it from
 * any other session is the role prompt assembled from the worker's template and
 * the working directory it runs in, so this module is the whole translation
 * layer: worker + template + task -> provider-agnostic session config.
 *
 * Kept free of I/O so the mapping can be tested directly; callers resolve the
 * template and the workspace path first.
 */
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";
import { buildMemorySections } from "./worker-memory.js";
import { assembleWorkerSystemPrompt, type WorkerTemplate } from "./worker-template.js";

/** The provider every worker runs on. Multi-provider support is deliberately absent. */
export const WORKER_PROVIDER = "pi";

export interface BuildWorkerSessionConfigInput {
  template: WorkerTemplate;
  /** Working directory for the task; the project workspace, not the worker's home. */
  cwd: string;
  /**
   * The worker's long-term memory, already read by the caller. This module
   * stays free of I/O, so the runner owns reading and this owns shaping: a
   * worker with no memory yet passes null.
   */
  memory: string | null;
  /** Optional per-task framing, e.g. the delegated task title and description. */
  taskPrompt?: string;
  model?: string;
  title?: string | null;
}

export interface WorkerSessionConfigResult {
  config: AgentSessionConfig;
  /** The role portion of the prompt, exposed so callers can log or assert on it. */
  rolePrompt: string;
}

/**
 * Build the session config for one worker task.
 *
 * The role prompt goes in `systemPrompt`, which pi's integration appends after
 * its own discovered prompt. `daemonAppendSystemPrompt` is left alone: it is
 * daemon-wide policy and must not be entangled with a worker's role.
 */
export function buildWorkerSessionConfig(
  input: BuildWorkerSessionConfigInput,
): WorkerSessionConfigResult {
  const rolePrompt = assembleWorkerSystemPrompt(input.template);
  if (rolePrompt.length === 0) {
    throw new Error(`Worker template '${input.template.id}' assembled an empty role prompt.`);
  }

  // Memory sits between the role and the task: the worker should know who it
  // is, then what it remembers, then what this unit of work asks. Ordering the
  // other way round would bury the role's rules under the memory's detail.
  const memorySections = buildMemorySections({ memory: input.memory });
  const withMemory = [rolePrompt, ...memorySections.sections].join("\n\n---\n\n");
  const systemPrompt = input.taskPrompt
    ? `${withMemory}\n\n---\n\n${input.taskPrompt.trim()}`
    : withMemory;

  return {
    rolePrompt,
    config: {
      provider: WORKER_PROVIDER,
      cwd: input.cwd,
      systemPrompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
    },
  };
}
