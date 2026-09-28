/**
 * The prompt a run carries: what the executing agent reads about its issue.
 *
 * Shaped after the source's task brief: the issue is the work unit, so the
 * prompt is built from the issue's own record — title, description, the
 * comment that triggered the run (if any), and the standing instruction that
 * output belongs back on the issue as a comment, in the issue's language.
 */
import type { AgentRow, CommentRow, IssueRow } from "./rows.js";

/**
 * The executing agent's own instructions, when it carries any. A run is a
 * session in the agent's role; without its instructions a Chief of Staff run
 * would be an amnesiac with a task list.
 */
function roleLines(agent: AgentRow): string[] {
  const instructions = agent.instructions?.trim();
  if (!instructions) {
    return [];
  }
  return ["## Your standing instructions", "", instructions, ""];
}

export function createIssuePrompt(input: { issue: IssueRow; agent: AgentRow }): string {
  const { issue, agent } = input;
  return [
    `You are ${agent.name}. Work this issue and report back.`,
    "",
    ...roleLines(agent),
    `# ${issue.title}`,
    "",
    issue.description ?? "(no description)",
    "",
    "When you finish, your report is the issue's record: state what you did,",
    "what you found, and anything that needs a decision. Reply in the issue's",
    "own language.",
  ].join("\n");
}

export function createCommentPrompt(input: {
  issue: IssueRow;
  agent: AgentRow;
  comment: CommentRow;
}): string {
  const { issue, agent, comment } = input;
  return [
    `You are ${agent.name}. A comment on your issue needs your attention.`,
    "",
    ...roleLines(agent),
    `# ${issue.title}`,
    "",
    issue.description ?? "(no description)",
    "",
    "## The comment",
    "",
    comment.content,
    "",
    "Address the comment on the issue: do what it asks or answer what it",
    "asks, and report the result as a reply. Reply in the issue's own language.",
  ].join("\n");
}

/**
 * The prompt a wakeup-dispatched run carries, after the source's
 * [WAKEUP] form: the trigger reports a fact, not business completion — the
 * run decides for itself whether the instruction's goal is met, and may
 * retire the subscription when the recurring work is done.
 */
export function createWakeupPrompt(input: {
  issue: IssueRow;
  agent: AgentRow;
  wakeupId: string;
  instruction: string;
  evidence: readonly Record<string, unknown>[];
}): string {
  const { issue, agent } = input;
  return [
    `You are ${agent.name}. Your assigned issue is #${issue.number ?? "?"}: ${issue.title}.`,
    "",
    "[WAKEUP]",
    input.instruction,
    "",
    "What woke you:",
    ...input.evidence.map((item) => `- ${JSON.stringify(item)}`),
    "",
    "Read the issue's current state and comment threads before acting. The",
    "trigger reports a fact, not business completion: decide yourself whether",
    "the instruction's goal is met. If the recurring work is no longer needed,",
    `retire the subscription: byspace multica issue wakeup disable --issue-id ${issue.id} --id ${input.wakeupId}.`,
    "Report back as a comment on the issue, in the issue's own language.",
  ].join("\n");
}

/**
 * The prompt a run_only autopilot task carries, after the source's
 * buildAutopilotPrompt: there is no issue for this run, so the brief states
 * that plainly and hands over the autopilot's own instructions.
 */
export function createAutopilotRunOnlyPrompt(input: {
  agent: AgentRow;
  autopilotId: string;
  autopilotTitle: string;
  autopilotDescription: string | null;
  runId: string;
  source: string;
}): string {
  const { agent } = input;
  const instructions = (input.autopilotDescription ?? "").trim();
  return [
    `You are ${agent.name}.`,
    "",
    "This task was triggered by an Autopilot in run-only mode. There is no",
    "assigned issue for this run.",
    "",
    `Autopilot run ID: ${input.runId}`,
    `Autopilot ID: ${input.autopilotId}`,
    `Autopilot title: ${input.autopilotTitle}`,
    `Trigger source: ${input.source}`,
    "",
    "Autopilot instructions:",
    instructions !== ""
      ? instructions
      : "(none — inspect the autopilot's configuration before proceeding)",
    "",
    "Complete the instructions above and report what you did as your final",
    "message; it is recorded as the run's result.",
  ].join("\n");
}
