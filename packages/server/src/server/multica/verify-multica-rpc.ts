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
import { createTestBySpaceDaemon } from "../test-utils/byspace-daemon.js";

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
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
        check(
          "issue create allocates number 1",
          issue.issue.number === 1,
          String(issue.issue.number),
        );
        const issues = await client.multicaIssueList({});
        check("issue list sees it", issues.issues.length === 1);
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
        const tasks = await client.multicaTaskList(issue.issue.id);
        check("task list is empty before any run", tasks.tasks.length === 0);

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
