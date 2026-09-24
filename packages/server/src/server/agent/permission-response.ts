import type { Logger } from "pino";

import type { AgentPermissionResponse, AgentPermissionResult } from "./agent-sdk-types.js";
import { startAgentRun, type AgentRunController } from "./agent-prompt.js";

export interface PermissionResponseAgentManager extends AgentRunController {
  respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void>;
}

export interface RespondToAgentPermissionParams {
  agentManager: PermissionResponseAgentManager;
  agentId: string;
  requestId: string;
  response: AgentPermissionResponse;
  logger: Logger;
  /**
   * Identity of the agent on whose behalf this response is being sent, when the
   * response comes from an agent at all. Human and console callers leave it
   * unset because they are not agents and therefore cannot be the subject of
   * their own request.
   */
  callerAgentId?: string;
}

/**
 * Permission requests are answered by a human or by a different agent. An agent
 * answering a request raised on itself defeats the approval: the request exists
 * precisely because the agent may not take that action unilaterally.
 */
export class SelfPermissionApprovalError extends Error {
  constructor(agentId: string, requestId: string) {
    super(
      `Agent ${agentId} cannot respond to its own permission request ${requestId}. ` +
        `A permission request must be resolved by the user or by another agent.`,
    );
    this.name = "SelfPermissionApprovalError";
  }
}

export function assertNotSelfPermissionApproval(params: {
  agentId: string;
  requestId: string;
  callerAgentId?: string;
}): void {
  const { agentId, requestId, callerAgentId } = params;
  if (!callerAgentId) return;
  if (callerAgentId !== agentId) return;
  throw new SelfPermissionApprovalError(agentId, requestId);
}

export async function respondToAgentPermission(
  params: RespondToAgentPermissionParams,
): Promise<void> {
  const { agentManager, agentId, requestId, response, logger } = params;

  assertNotSelfPermissionApproval({
    agentId,
    requestId,
    callerAgentId: params.callerAgentId,
  });

  logger.debug(
    { agentId, requestId },
    `Handling permission response for agent ${agentId}, request ${requestId}`,
  );

  const result = await agentManager.respondToPermission(agentId, requestId, response);
  logger.debug({ agentId }, `Permission response forwarded to agent ${agentId}`);

  if (result?.followUpPrompt) {
    logger.debug({ agentId }, "Permission response requires follow-up turn, starting agent stream");
    await startAgentRun(agentManager, agentId, result.followUpPrompt, logger, {
      replaceRunning: true,
    });
  }
}
