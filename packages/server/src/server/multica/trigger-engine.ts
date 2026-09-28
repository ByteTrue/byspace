/**
 * The trigger engine: deciding when an issue write or a comment starts a run.
 *
 * Ported from the source's single predicate (service/issue_trigger.go's
 * WillEnqueueRun) and the comment trigger path (handler/comment.go's
 * computeCommentAgentTriggers). The source's own history is the design
 * argument: per-site copies of this decision drifted (squad omitted,
 * self-loop omitted, four entry points inconsistent — MUL-3375), so it exists
 * in exactly one place there and one place here.
 *
 * Rules, from the source:
 *   - backlog is the parking lot: assigning into it or leaving it for another
 *     unstarted status never starts a run; only a write that leaves backlog
 *     toward an active status does.
 *   - terminal statuses start nothing.
 *   - a squad assignee resolves to its leader (the run's agent).
 *   - a comment with explicit @agent/@squad mentions triggers those, and wins
 *     over @all, which only suppresses the implicit fallbacks.
 *   - agent-authored comments do not participate in member-driven implicit
 *     routing — an agent that wants to wake another agent names it.
 *   - the pending-task dedup: an agent already holding a pending run on the
 *     issue coalesces instead of enqueueing a second.
 */
import type { MulticaStore } from "./store.js";
import type { IssueRow, TaskRow } from "./rows.js";

export interface TriggerDecision {
  readonly agentId: string;
  readonly assigneeType: string;
  readonly source: "assign" | "status";
}

const ACTIVE_NON_TERMINAL = new Set([
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "custom_active",
]);

/**
 * Will this issue write start a run, and for whom.
 *
 * `issue` is the post-write shape; the flags mark which fields the write
 * touched. Mirrors the source predicate's guards in order.
 */
export function willEnqueueRun(input: {
  store: MulticaStore;
  issue: IssueRow;
  isCreate: boolean;
  assigneeChanged: boolean;
  statusChanged: boolean;
  prevStatus: string;
}): TriggerDecision | null {
  const { store, issue } = input;
  if (issue.assigneeType === null || issue.assigneeId === null) {
    return null;
  }
  // Triage refuses a run outright (stricter than backlog's parking lot).
  if (issue.triageState !== null) {
    return null;
  }

  let source: "assign" | "status";
  if (input.isCreate || input.assigneeChanged) {
    // Backlog is the parking lot: assigning into it never starts a run.
    if (issue.status === "backlog") {
      return null;
    }
    source = "assign";
  } else if (input.statusChanged && input.prevStatus === "backlog" && issue.status !== "backlog") {
    if (isTerminal(issue.status) || !ACTIVE_NON_TERMINAL.has(effectiveActive(issue.status))) {
      return null;
    }
    source = "status";
  } else {
    return null;
  }

  // A squad assignee resolves to its leader — the run's executing agent.
  let agentId = issue.assigneeId;
  let assigneeType = issue.assigneeType;
  if (issue.assigneeType === "squad") {
    const squad = store.getSquad(issue.assigneeId);
    agentId = squad.leaderId;
    assigneeType = "agent";
  }
  return { agentId, assigneeType, source };
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "cancelled";
}

/**
 * Effective status: the built-in keys pass through; a custom key resolves to
 * its category in the store's catalog. Terminal categories are terminal.
 */
function effectiveActive(status: string): string {
  return status === "todo" ||
    status === "in_progress" ||
    status === "in_review" ||
    status === "blocked"
    ? status
    : "custom_active";
}

/**
 * The comment trigger: which agents does this comment wake.
 *
 * Explicit @mentions win; @all suppresses the implicit fallbacks but never a
 * named target; agent authors get no implicit routing (they must name who
 * they want); the fallback routes to the issue's assignee when a human wrote
 * the comment on an assigned issue.
 */
export function commentTriggers(input: {
  store: MulticaStore;
  issue: IssueRow;
  content: string;
  authorType: string;
  authorId: string;
  /** Mentions parsed from the content: markup or bare-name aliases. */
  mentions: readonly ParsedMention[];
}): Array<{ agentId: string; reason: "mention" | "assignee" }> {
  const { store, issue, authorType, mentions } = input;
  const results: Array<{ agentId: string; reason: "mention" | "assignee" }> = [];
  const seen = new Set<string>();
  const hasAgentOrSquadMention = mentions.length > 0;
  const hasMentionAll = mentions.some((mention) => mention.kind === "all");

  const push = (agentId: string, reason: "mention" | "assignee") => {
    if (seen.has(agentId)) {
      return;
    }
    seen.add(agentId);
    results.push({ agentId, reason });
  };

  if (hasAgentOrSquadMention) {
    // Explicit mentions wake their targets; the markup carries ids, bare
    // names resolve through the rosters.
    for (const agentId of mentionWakeTargets(store, mentions)) {
      push(agentId, "mention");
    }
    return results;
  }

  if (hasMentionAll) {
    // @all only suppresses the implicit fallbacks — nothing else triggers.
    return results;
  }

  if (authorType !== "owner") {
    // Agent-authored comments do not participate in member-driven implicit
    // routing; an agent that wants to wake another agent names it.
    return results;
  }

  // The implicit fallback: a human comment on an assigned issue routes to
  // the assignee (the squad leader for a squad issue).
  if (issue.assigneeType !== null && issue.assigneeId !== null) {
    if (issue.assigneeType === "squad") {
      const squad = store.getSquad(issue.assigneeId);
      push(squad.leaderId, "assignee");
    } else {
      push(issue.assigneeId, "assignee");
    }
  }
  return results;
}

function findAgentByName(store: MulticaStore, name: string): string | null {
  const agents = store.listAgents();
  const match = agents.find((agent) => agent.name.toLowerCase() === name.toLowerCase());
  return match ? match.id : null;
}

function findSquadByName(
  store: MulticaStore,
  name: string,
): { id: string; leaderId: string } | null {
  const squads = store.listSquads();
  const match = squads.find((squad) => squad.name.toLowerCase() === name.toLowerCase());
  return match ? { id: match.id, leaderId: match.leaderId } : null;
}

/**
 * Parse @mentions from comment content.
 *
 * The source's ParseMentions handles rich forms; the replica's comments are
 * plain text, so the parser takes `@word` tokens — a word boundary, an @,
 * and a run of name characters.
 */
export interface ParsedMention {
  /** markup carries the target directly; a bare @name is a legacy alias. */
  readonly kind: "agent" | "squad" | "all" | "name";
  readonly id: string | null;
  readonly name: string | null;
}

/**
 * Mentions, in the source's grammar: markdown markup
 * `[@Label](mention://agent|squad|all/<id|all>)` — the form its composer
 * emits and its MentionRe matches. A bare `@Name` remains readable as an
 * alias (single name token), because our CLI and older comments wrote it;
 * multi-word names need the markup, which carries the id and never
 * truncates on a space.
 */
export function parseMentions(content: string): ParsedMention[] {
  const out: ParsedMention[] = [];
  const markup = /\[@?[^\]]*\]\(mention:\/\/(member|agent|squad|issue|all)\/([0-9a-fA-F-]+|all)\)/g;
  for (const match of content.matchAll(markup)) {
    const kind = match[1];
    const id = match[2];
    if (kind === "all" || id === "all") {
      out.push({ kind: "all", id: null, name: null });
      continue;
    }
    if (kind === "agent") {
      out.push({ kind: "agent", id, name: null });
    } else if (kind === "squad") {
      out.push({ kind: "squad", id, name: null });
    }
    // member and issue mentions name humans and records: nothing to wake.
  }
  const stripped = content.replace(markup, " ");
  const bare = /(?:^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]+)/g;
  for (const match of stripped.matchAll(bare)) {
    const name = match[1];
    if (!out.some((entry) => entry.name === name)) {
      out.push({ kind: "name", id: null, name });
    }
  }
  return out;
}

/** Which agents a comment's mentions wake: markup ids straight, names resolved. */
export function mentionWakeTargets(
  store: MulticaStore,
  mentions: readonly ParsedMention[],
): string[] {
  const targets: string[] = [];
  const push = (id: string): void => {
    if (!targets.includes(id)) {
      targets.push(id);
    }
  };
  for (const mention of mentions) {
    if (mention.kind === "agent" && mention.id !== null) {
      push(mention.id);
      continue;
    }
    if (mention.kind === "squad" && mention.id !== null) {
      try {
        push(store.getSquad(mention.id).leaderId);
      } catch {
        // An unknown squad names nobody.
      }
      continue;
    }
    if (mention.kind === "name" && mention.name !== null) {
      const agent = findAgentByName(store, mention.name);
      if (agent !== null) {
        push(agent);
        continue;
      }
      const squad = findSquadByName(store, mention.name);
      if (squad !== null) {
        push(squad.leaderId);
      }
    }
  }
  return targets;
}

/**
 * The pending-task dedup: does this agent already hold a pending run on this
 * issue. The source enforces this with a partial unique index over pending
 * tasks; the replica's store is the single writer in-process, so the check
 * reads the queue directly.
 */
export function hasPendingRun(
  store: MulticaStore,
  issueId: string,
  agentId: string,
): TaskRow | null {
  const tasks = store.listTasksForIssue(issueId);
  const pending = tasks.find(
    (task) =>
      task.agentId === agentId && (task.status === "queued" || task.status === "dispatched"),
  );
  return pending ?? null;
}
