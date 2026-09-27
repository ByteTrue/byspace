/**
 * The prompt a run carries: what the executing agent reads about its issue.
 *
 * Shaped after the source's task brief: the issue is the work unit, so the
 * prompt is built from the issue's own record — title, description, the
 * comment that triggered the run (if any), and the standing instruction that
 * output belongs back on the issue as a comment, in the issue's language.
 */
import type { AgentRow, CommentRow, IssueRow } from "./rows.js";

export function createIssuePrompt(input: { issue: IssueRow; agent: AgentRow }): string {
  const { issue, agent } = input;
  return [
    `You are ${agent.name}. Work this issue and report back.`,
    "",
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
