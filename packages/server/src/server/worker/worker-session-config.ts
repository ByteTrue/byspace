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
import { assembleWorkerSystemPrompt, type WorkerTemplate } from "./worker-template.js";

/** The provider every worker runs on. Multi-provider support is deliberately absent. */
export const WORKER_PROVIDER = "pi";

export interface BuildWorkerSessionConfigInput {
  template: WorkerTemplate;
  /** Working directory for the task; the project workspace, not the worker's home. */
  cwd: string;
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

  const systemPrompt = input.taskPrompt
    ? `${rolePrompt}\n\n---\n\n${input.taskPrompt.trim()}`
    : rolePrompt;

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
