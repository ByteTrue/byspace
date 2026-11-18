import type { AgentSessionConfig } from "@bytetrue/protocol/agent-types";
import type { AgentSnapshotPayload, CreateAgentRequestMessage } from "@bytetrue/protocol/messages";
import type { DaemonClient } from "@bytetrue/client/internal/daemon-client";
import { encodeImages } from "@/utils/encode-images";
import { enforceImageWireBudget } from "@/composer/attachments/image-wire-budget";
import type { UserMessageImageAttachment } from "@/types/stream";

export interface WorkspaceDraftAgentRequest {
  workspaceId: string;
  config: AgentSessionConfig;
  text: string;
  clientMessageId: string;
  images?: UserMessageImageAttachment[];
  attachments?: CreateAgentRequestMessage["attachments"];
}

/**
 * Shared by the workspace draft tab and by the new-workspace screen when it finishes creation
 * after the user has already navigated away and no draft tab will ever mount.
 */
export async function requestWorkspaceDraftAgent(
  client: DaemonClient,
  request: WorkspaceDraftAgentRequest,
): Promise<AgentSnapshotPayload> {
  const encoded = await encodeImages(request.images);
  const budgeted = await enforceImageWireBudget({
    client,
    text: request.text,
    images: encoded ?? [],
    attachments: request.attachments ?? [],
    fileNames: (request.images ?? []).map((metadata) => metadata.fileName),
  });
  return await client.createAgent({
    config: request.config,
    workspaceId: request.workspaceId,
    clientMessageId: request.clientMessageId,
    ...(request.text ? { initialPrompt: request.text } : {}),
    ...(budgeted.images.length > 0 ? { images: budgeted.images } : {}),
    ...(budgeted.attachments.length > 0 ? { attachments: budgeted.attachments } : {}),
  });
}
