import { parseWorkspaceOpenIntent } from "@/utils/host-routes";

/**
 * Whether a surface already shows this Chief agent, so the floating window and
 * its button would duplicate what is on screen.
 *
 * Three signals, because no single one covers the whole flow:
 *
 * - the dedicated agent route, `/h/<server>/agent/<agentId>`;
 * - a workspace route opened onto the agent,
 *   `/h/<server>/workspace/<ws>?open=agent:<agentId>` — where the compact FAB
 *   navigates. This is the intent param, and it is transient: the workspace
 *   route consumes it and strips it from the URL, so it covers only the first
 *   frames after the navigation;
 * - the workspace screen reporting this agent as its focused one
 *   (`focusedAgentId`), which is what the intent settles into and the durable
 *   half of the answer. Without it the button reappeared on a phone once the
 *   URL was cleaned up, floating over the pane it was supposed to stay out of.
 */
export function isShowingChiefAgent(input: {
  pathname: string;
  openIntentParam: string | readonly string[] | undefined;
  focusedAgentId: string | null | undefined;
  agentId: string;
}): boolean {
  const { pathname, openIntentParam, focusedAgentId, agentId } = input;
  if (!agentId) return false;
  if (focusedAgentId === agentId) return true;
  if (pathname.includes(`/agent/${agentId}`)) return true;
  const param = Array.isArray(openIntentParam) ? openIntentParam[0] : openIntentParam;
  const openedTarget = parseWorkspaceOpenIntent(typeof param === "string" ? param : undefined);
  return openedTarget?.kind === "agent" && openedTarget.agentId === agentId;
}
