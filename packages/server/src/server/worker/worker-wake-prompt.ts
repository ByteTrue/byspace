import type { WorkerGroupMemberRecord, WorkerMessageRecord } from "./worker-store.js";

/**
 * The prompt a woken worker is given.
 *
 * Pure and separate so its shape is testable without a runner: what a worker is
 * told determines what it can do, and a wake that fails to say who spoke or how
 * to reply produces a worker that answers into the void.
 */

/** The framing the worker sees when nothing it can act on arrived. */
export const NO_ACTIONABLE_MESSAGES =
  "A wake was scheduled but no messages are waiting. Do nothing and end.";

export interface BuildWakePromptInput {
  workerName: string;
  workerId: string;
  groupId: string;
  /** The messages that woke this worker, oldest first. */
  messages: readonly WorkerMessageRecord[];
  /** The group's roster, so a worker can address members by name. */
  members: readonly WorkerGroupMemberRecord[];
  nameById: ReadonlyMap<string, string>;
}

/**
 * Write the turn's framing.
 *
 * Deliberately not imperative about execution. A worker told to "run this exact
 * command and report it verbatim" reads as an injection attempt and is refused;
 * a worker told what arrived and what is expected of it acts on its own. The
 * commands are named because the role's skill documents them, not because this
 * prompt should be driving the shell.
 */
export function buildWakePrompt(input: BuildWakePromptInput): string {
  if (input.messages.length === 0) {
    return NO_ACTIONABLE_MESSAGES;
  }

  const lines = [
    `You are ${input.workerName}, a member of one project group.`,
    `${input.messages.length} message${input.messages.length === 1 ? "" : "s"} arrived for you.`,
    "",
    "The group, oldest first:",
    ...input.members.map((member) => {
      const name = input.nameById.get(member.workerId) ?? member.workerId;
      return `- ${name}${member.role === "coordinator" ? " (coordinator)" : ""}`;
    }),
    "",
    "What arrived:",
  ];

  for (const message of input.messages) {
    const from = input.nameById.get(message.senderWorkerId) ?? message.senderWorkerId;
    lines.push(`- [${message.messageId}] ${from}: ${message.body}`);
    // A reply is threaded to what it answers, so a reader can follow which
    // question each answer belongs to.
    if (message.replyToMessageId) {
      lines.push(`  (in reply to ${message.replyToMessageId})`);
    }
  }

  lines.push(
    "",
    "Reply into the group so the people waiting can see it. The commands you need are",
    "in your worker-team skill: read what is missing before deciding, send what you",
    "conclude, and report a blocker rather than inventing an answer.",
  );

  return lines.join("\n");
}
