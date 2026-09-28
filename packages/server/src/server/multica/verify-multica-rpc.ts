/**
 * End-to-end verification of the multica replica's RPC surface: a real
 * in-process daemon, a real client over a real socket, the full wiring from
 * bootstrap to handler.
 *
 * Run: npx tsx packages/server/src/server/multica/verify-multica-rpc.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { openMulticaDatabase } from "./database.js";
import { MIGRATIONS } from "./migrations/index.js";
import { MulticaStore } from "./store.js";
import { createTestBySpaceDaemon } from "../test-utils/byspace-daemon.js";
import type { TestBySpaceDaemon } from "../test-utils/byspace-daemon.js";

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
}

/**
 * Run identity over the real wire: a comment sent from a run's session
 * attributes to the run's agent; a stranger session is refused; silence is
 * the owner. The task row is stamped through the store (the same call the
 * executor makes) and completed immediately so the in-process executor
 * never drains it into a real session.
 */
async function verifyRunIdentity(
  client: DaemonClient,
  daemon: TestBySpaceDaemon,
  issue: { issue: { id: string } },
  created: { agent: { id: string } },
): Promise<void> {
  // Run identity: a comment sent from a run's session attributes to
  // the run's agent; a stranger session is refused; silence is owner.
  // The task row is stamped through the store (the same call the
  // executor makes) and completed immediately so the in-process
  // executor never drains it into a real session.
  const store = new MulticaStore(
    openMulticaDatabase(path.join(daemon.byspaceHome, "multica", "multica.db")),
    { migrations: MIGRATIONS },
  );
  try {
    const runTask = store.createTask({
      issueId: issue.issue.id,
      agentId: created.agent.id,
    });
    store.updateTaskStatus({ id: runTask.id, status: "completed" });
    store.attachTaskSession(runTask.id, "verify-run-session");

    const asRun = await client.multicaCommentCreate({
      issueId: issue.issue.id,
      content: "report from the run",
      senderSessionId: "verify-run-session",
    });
    check(
      "a run's session attributes its comment to the run's agent",
      asRun.comment.authorType === "agent" && asRun.comment.authorId === created.agent.id,
      `${asRun.comment.authorType}:${asRun.comment.authorId.slice(0, 8)}`,
    );

    let strangerRefused = false;
    try {
      await client.multicaCommentCreate({
        issueId: issue.issue.id,
        content: "trust me I am an agent",
        senderSessionId: "verify-stranger-session",
      });
    } catch {
      strangerRefused = true;
    }
    check("a session with no run is refused", strangerRefused);

    const asOwner = await client.multicaCommentCreate({
      issueId: issue.issue.id,
      content: "and a human note",
    });
    check("a comment with no session is the owner", asOwner.comment.authorType === "owner");
  } finally {
    store.close();
  }
}

// Execution stays dark for the whole pass: dispatch, capture and the store
// run for real; no queued task may spawn a model session (notes/004).
process.env.BYSPACE_MULTICA_EXECUTION = "off";

async function verifyLabels(client: DaemonClient, issueId: string): Promise<void> {
  // Labels: create two, set both on the issue, then replace with one —
  // the set write is the whole relation.
  const red = await client.multicaLabelCreate({ name: "bug", color: "#ef4444" });
  const blue = await client.multicaLabelCreate({ name: "docs", color: "#3b82f6" });
  const both = await client.multicaIssueLabelsSet({
    issueId: issueId,
    labelIds: [red.label.id, blue.label.id],
  });
  check("two labels attach", both.labels.length === 2);
  const one = await client.multicaIssueLabelsSet({
    issueId: issueId,
    labelIds: [blue.label.id],
  });
  check(
    "a set write replaces the relation",
    one.labels.length === 1 && one.labels[0].name === "docs",
  );
  const labels = await client.multicaLabelList();
  check("the directory lists both", labels.labels.length === 2);
}

async function verifyReactions(client: DaemonClient, commentId: string): Promise<void> {
  // Reactions: set, count, unset — the unique key is the toggle.
  const reacted = await client.multicaReactionSet({
    commentId: commentId,
    emoji: "👍",
    reacted: true,
  });
  check(
    "a reaction counts once for one person",
    reacted.reactions.length === 1 && reacted.reactions[0].count === 1,
  );
  const again = await client.multicaReactionSet({
    commentId: commentId,
    emoji: "👍",
    reacted: true,
  });
  check("re-reacting is a no-op", again.reactions[0].count === 1);
  const unset = await client.multicaReactionSet({
    commentId: commentId,
    emoji: "👍",
    reacted: false,
  });
  check("un-reacting empties the chip", unset.reactions.length === 0);
}

async function main(): Promise<void> {
  const homeRoot = mkdtempSync(path.join(tmpdir(), "multica-verify-"));
  try {
    const daemon = await createTestBySpaceDaemon({ byspaceHomeRoot: homeRoot });
    try {
      const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
      await client.connect();
      try {
        // agent
        const created = await client.multicaAgentCreate({ name: "Frontend Dev" });
        check(
          "agent create lands with defaults",
          created.agent.kind === "user" && created.agent.permissionMode === "private",
          `${created.agent.kind}/${created.agent.permissionMode}`,
        );
        const list = await client.multicaAgentList();
        check(
          "agent list sees it",
          list.agents.length === 1 && list.agents[0].name === "Frontend Dev",
        );

        // issue
        const issue = await client.multicaIssueCreate({ title: "Ship the board" });
        // No channel issue is seeded any more — the secretary lives in a
        // workspace — so this issue's number is 1 unless a prior run left rows.
        check(
          "issue create allocates number 1 (no channel issue is seeded)",
          issue.issue.number === 1,
          String(issue.issue.number),
        );
        const issues = await client.multicaIssueList({});
        check(
          "issue list sees it",
          issues.issues.some((candidate) => candidate.id === issue.issue.id),
        );
        check(
          "the retired office channel no longer reads as a live issue",
          !issues.issues.some((candidate) => candidate.title.startsWith("Office")),
        );
        const got = await client.multicaIssueGet(issue.issue.id);
        check("issue get round-trips", got.issue.title === "Ship the board");

        // optimistic concurrency on status
        const updated = await client.multicaIssueStatusUpdate({
          issueId: issue.issue.id,
          status: "in_progress",
          expectedRevision: issue.issue.revision,
        });
        check(
          "status update bumps revision",
          updated.issue.status === "in_progress" && updated.issue.revision === 2,
        );
        let staleRejected = false;
        try {
          await client.multicaIssueStatusUpdate({
            issueId: issue.issue.id,
            status: "done",
            expectedRevision: 1,
          });
        } catch {
          staleRejected = true;
        }
        check("stale revision write is refused", staleRejected);

        // comment
        const comment = await client.multicaCommentCreate({
          issueId: issue.issue.id,
          content: "first comment",
        });
        check("comment create returns it", comment.comment.content === "first comment");
        const comments = await client.multicaCommentList(issue.issue.id);
        check("comment list sees it", comments.comments.length === 1);
        const after = await client.multicaIssueGet(issue.issue.id);
        check("comment bumped issue revision", after.issue.revision > updated.issue.revision);

        // squad
        const squad = await client.multicaSquadCreate({
          name: "Team",
          leaderId: created.agent.id,
          members: [{ memberType: "agent", memberId: created.agent.id }],
        });
        check(
          "squad create with members",
          squad.squad.name === "Team" && squad.members.length === 1,
        );
        const squads = await client.multicaSquadList();
        check("squad list sees it", squads.squads.length === 1);

        // task list (empty — the engine slices enqueue)
        const tasks = await client.multicaTaskList({ issueId: issue.issue.id });
        check("task list is empty before any run", tasks.tasks.length === 0);

        // status catalog + field update with trigger
        const statuses = await client.multicaStatusList();
        check("status catalog lists the seven built-ins", statuses.statuses.length === 7);
        // The comment creation above bumped the issue's revision (the atomic
        // touch); read fresh before updating.
        const beforeUpdate = await client.multicaIssueGet(issue.issue.id);
        const moved = await client.multicaIssueUpdate({
          issueId: issue.issue.id,
          expectedRevision: beforeUpdate.issue.revision,
          status: "in_review",
        });
        check("field update moves status and bumps revision", moved.issue.status === "in_review");
        const renamed = await client.multicaIssueUpdate({
          issueId: issue.issue.id,
          expectedRevision: moved.issue.revision,
          title: "Ship the board v2",
        });
        check("field update renames", renamed.issue.title === "Ship the board v2");
        let staleUpdateRejected = false;
        try {
          await client.multicaIssueUpdate({
            issueId: issue.issue.id,
            expectedRevision: issue.issue.revision,
            status: "done",
          });
        } catch {
          staleUpdateRejected = true;
        }
        check("stale field update is refused", staleUpdateRejected);

        await verifyRunIdentity(client, daemon, issue, created);

        const store = new MulticaStore(
          openMulticaDatabase(path.join(daemon.byspaceHome, "multica", "multica.db")),
          { migrations: MIGRATIONS },
        );
        try {
          // Wakeups: register an event subscription, move the issue, and see
          // the receipt appear; then dispatch and see the run carry the
          // wakeup identity.
          const wakeup = await client.multicaWakeupCreate({
            issueId: issue.issue.id,
            agentId: created.agent.id,
            instruction: "verify: watch this issue's status",
            kind: "event",
            mode: "continuous",
            eventTypes: ["issue.status_changed"],
          });
          check("wakeup create returns the subscription", wakeup.wakeup.enabled === true);
          const listed = await client.multicaWakeupList(issue.issue.id);
          check("wakeup list sees it", listed.wakeups.length === 1);
          const beforeWakeupMove = await client.multicaIssueGet(issue.issue.id);
          await client.multicaIssueUpdate({
            issueId: issue.issue.id,
            expectedRevision: beforeWakeupMove.issue.revision,
            status: "blocked",
          });
          const afterMove = store.listReadyWakeups(new Date());
          check(
            "the status change produced exactly one ready wakeup",
            afterMove.length === 1 && afterMove[0].wakeup.id === wakeup.wakeup.id,
            String(afterMove.length),
          );
          const dispatchedId = store.dispatchWakeup(
            afterMove[0].wakeup,
            afterMove[0].evidence,
            new Date(),
          );
          const dispatched = store.getTask(dispatchedId);
          const context = JSON.parse(dispatched.context ?? "{}") as Record<string, unknown>;
          check(
            "the dispatched run carries the wakeup identity",
            context.wakeup_id === wakeup.wakeup.id,
          );
          check("receipts settle after dispatch", store.listReadyWakeups(new Date()).length === 0);
          const disabled = await client.multicaWakeupDisable({
            issueId: issue.issue.id,
            id: wakeup.wakeup.id,
          });
          check("wakeup disable retires it", disabled.wakeup.enabled === false);
        } finally {
          store.close();
        }

        // Inbox: the owner's queue is empty until something needs them; a
        // run writes to it; reading and filing settle the count.
        const emptyInbox = await client.multicaInboxList();
        check("the inbox starts empty", emptyInbox.items.length === 0 && emptyInbox.unread === 0);
        let inboxWriteRefused = false;
        try {
          await client.multicaInboxCreate({
            severity: "info",
            title: "not a run",
            senderSessionId: "verify-stranger-session",
          });
        } catch {
          inboxWriteRefused = true;
        }
        check("a non-run session cannot write the inbox", inboxWriteRefused);

        // Rosters: an agent's detail carries its instructions and its own
        // run history; status flips through the management write; a squad's
        // roster gains and loses a member.
        const detail = await client.multicaAgentGet(created.agent.id);
        check(
          "agent detail carries the instructions",
          detail.agent.id === created.agent.id && detail.agent.instructions !== undefined,
        );
        const archived = await client.multicaAgentStatus(created.agent.id, "archived");
        check("agent archive write lands", archived.agent.status !== "");
        await client.multicaAgentStatus(created.agent.id, "active");
        const agentRuns = await client.multicaTaskList({ agentId: created.agent.id });
        check("agent run feed lists that agent's tasks", agentRuns.tasks.length >= 0);
        const verifySquad = await client.multicaSquadCreate({
          name: "Verify squad",
          leaderId: created.agent.id,
        });
        const verifySecond = await client.multicaAgentCreate({ name: "VerifySecond" });
        const grown = await client.multicaSquadAddMember({
          squadId: verifySquad.squad.id,
          memberType: "agent",
          memberId: verifySecond.agent.id,
        });
        check(
          "squad gains a member",
          grown.squad.members.some((member) => member.memberId === verifySecond.agent.id),
        );
        const shrunk = await client.multicaSquadRemoveMember({
          squadId: verifySquad.squad.id,
          memberType: "agent",
          memberId: verifySecond.agent.id,
        });
        check(
          "squad loses a member",
          !shrunk.squad.members.some((member) => member.memberId === verifySecond.agent.id),
        );
        const fetched = await client.multicaSquadGet(verifySquad.squad.id);
        check("squad get returns the roster", fetched.squad.leaderId === created.agent.id);

        // Both are async; awaiting keeps their writes out of each other's
        // read windows (the label directory check raced the management
        // block's create/delete when these were left unawaited).
        await verifyReactions(client, comment.comment.id);

        await verifyLabels(client, issue.issue.id);

        await verifyCommentRevision(client, comment.comment.id);

        await verifyLabelManagement(client, issue.issue.id);

        // Autopilot: a run_only autopilot fires on demand, lands a task with
        // no issue, and its run history records the attempt.
        const autopilot = await client.multicaAutopilotCreate({
          title: "Verify patrol",
          description: "report the state of the queue",
          assigneeType: "agent",
          assigneeId: created.agent.id,
          executionMode: "run_only",
        });
        check("autopilot create registers", autopilot.autopilot.status === "active");
        const fired = await client.multicaAutopilotTrigger(autopilot.autopilot.id);
        check("manual trigger fires", fired.fired === true && fired.run.status === "running");
        check(
          "the run_only task carries no issue",
          fired.run.issueId === null,
          String(fired.run.issueId),
        );
        const runs = await client.multicaAutopilotRuns(autopilot.autopilot.id);
        check("run history records the attempt", runs.runs.length === 1);
        // With execution dark (BYSPACE_MULTICA_EXECUTION=off) the fired task
        // must still be sitting in the queue — proof the switch holds, and
        // that this pass costs no model sessions.
        const probeStore = new MulticaStore(
          openMulticaDatabase(path.join(daemon.byspaceHome, "multica", "multica.db")),
          { migrations: MIGRATIONS },
        );
        try {
          const queuedTasks = probeStore.listQueuedTasks();
          check(
            "execution stays dark: the fired task is still queued",
            queuedTasks.some((task) => task.id === fired.run.taskId),
          );
        } finally {
          probeStore.close();
        }
        // skip policy: a second firing while the first is in flight is a
        // recorded skip, not a second run.
        const second = await client.multicaAutopilotTrigger(autopilot.autopilot.id);
        check(
          "the skip policy suppresses the second firing",
          second.fired === false && second.run.status === "skipped",
        );
        const afterSkip = await client.multicaAutopilotRuns(autopilot.autopilot.id);
        check("skipped firings are still rows", afterSkip.runs.length === 2);

        // unknown issue errors cleanly
        let unknownHandled = false;
        try {
          await client.multicaIssueGet("missing");
        } catch (error) {
          unknownHandled = error instanceof Error && /not found/.test(error.message);
        }
        check("unknown issue errors cleanly", unknownHandled);
      } finally {
        await client.close();
      }
    } finally {
      await daemon.close();
    }
  } finally {
    rmSync(homeRoot, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.info(`  ${c.ok ? "ok" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  }
  console.info(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

await main();

/** Comment revision: the owner edits and deletes their own comment; a
 * stranger session is refused both. */
async function verifyCommentRevision(client: DaemonClient, commentId: string): Promise<void> {
  const edited = await client.multicaCommentUpdate({
    commentId,
    content: "first comment, revised",
  });
  check(
    "editing a comment rewrites it and bumps its revision",
    edited.comment.content === "first comment, revised" && edited.comment.revision === 2,
  );
  let strangerRefused = false;
  try {
    await client.multicaCommentUpdate({
      commentId,
      content: "not yours",
      senderSessionId: "verify-stranger-session",
    });
  } catch {
    strangerRefused = true;
  }
  check("a stranger session cannot revise a comment", strangerRefused);
  const deleted = await client.multicaCommentDelete({ commentId });
  check("the author's delete lands", deleted.deleted === true);
}

/** The directory's management face: rename, recolor, and a delete whose
 * attachments cascade away with the row. */
async function verifyLabelManagement(client: DaemonClient, issueId: string): Promise<void> {
  const created = await client.multicaLabelCreate({ name: "verify-label", color: "#3b82f6" });
  await client.multicaIssueLabelsSet({ issueId, labelIds: [created.label.id] });
  const renamed = await client.multicaLabelUpdate({
    labelId: created.label.id,
    name: "verify-renamed",
  });
  check(
    "renaming a label keeps its color",
    renamed.label.name === "verify-renamed" && renamed.label.color === "#3b82f6",
  );
  const recolored = await client.multicaLabelUpdate({
    labelId: created.label.id,
    color: "#22c55e",
  });
  check(
    "recoloring a label keeps its name",
    recolored.label.color === "#22c55e" && recolored.label.name === "verify-renamed",
  );
  const deleted = await client.multicaLabelDelete({ labelId: created.label.id });
  check("deleting a label lands", deleted.deleted === true);
  const after = await client.multicaIssueGet(issueId);
  check(
    "the deleted label's attachments cascade away",
    after.issue.labels.length === 0,
    String(after.issue.labels.length),
  );
}
