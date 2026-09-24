import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, collectMultiple } from "../../utils/command-options.js";
import { runWorkerCreateCommand } from "./create.js";
import {
  runGroupAddWorkerCommand,
  runGroupCreateCommand,
  runGroupLsCommand,
  runGroupRemoveWorkerCommand,
} from "./group.js";
import { runWorkerLsCommand } from "./ls.js";
import {
  runWorkerTaskCreateCommand,
  runWorkerTaskLsCommand,
  runWorkerTaskRunCommand,
} from "./task.js";
import { runWorkerTemplateLsCommand } from "./templates.js";

/**
 * Worker and group management.
 *
 * Mirrors the shape the worker's own skills document: workers and the groups
 * they form are managed through this CLI, which is how a coordinator worker
 * assembles a team. Skills carry the prose rules; the daemon's permission layer
 * is what actually enforces them.
 */
export function createWorkerCommand(): Command {
  const worker = new Command("worker").description("Manage workers and their groups");

  addJsonAndDaemonHostOptions(worker.command("ls").description("List workers")).action(
    withOutput(runWorkerLsCommand),
  );

  addJsonAndDaemonHostOptions(
    worker
      .command("create")
      .description("Create a worker with a role")
      .requiredOption("--name <name>", "Human-readable worker name")
      .requiredOption("--template-id <id>", "Role template id (see: worker templates)")
      .option(
        "--workspace-path <path>",
        "Working directory (default: a directory under BySpace home)",
      )
      .allowExcessArguments(false),
  ).action(withOutput(runWorkerCreateCommand));

  addJsonAndDaemonHostOptions(
    worker
      .command("templates")
      .description("List the roles a worker can be created with")
      .allowExcessArguments(false),
  ).action(withOutput(runWorkerTemplateLsCommand));

  const task = worker.command("task").description("Tasks assigned to workers");

  addJsonAndDaemonHostOptions(
    task
      .command("ls")
      .description("List tasks, optionally for one worker")
      .option("--worker-id <id>", "Only this worker's tasks")
      .allowExcessArguments(false),
  ).action(withOutput(runWorkerTaskLsCommand));

  addJsonAndDaemonHostOptions(
    task
      .command("create")
      .description("Create a task for a worker")
      .requiredOption("--worker-id <id>", "Worker to own the task")
      .requiredOption("--title <title>", "What the task is")
      .allowExcessArguments(false),
  ).action(withOutput(runWorkerTaskCreateCommand));

  addJsonAndDaemonHostOptions(
    task
      .command("run")
      .description("Run a task and wait for its outcome")
      .argument("<task-id>", "Task id")
      .allowExcessArguments(false),
  ).action(withOutput(runWorkerTaskRunCommand));

  const group = worker.command("group").description("Project groups: a team on one project");

  addJsonAndDaemonHostOptions(group.command("ls").description("List groups")).action(
    withOutput(runGroupLsCommand),
  );

  addJsonAndDaemonHostOptions(
    group
      .command("create")
      .description("Create a group, optionally with its whole roster")
      .requiredOption("--name <name>", "Group name")
      .requiredOption("--project-id <id>", "Project the group works on")
      .option("--goal <goal>", "What the group is trying to achieve")
      .option("--coordinator <worker-id>", "Worker who leads the group")
      .option("--member <worker-id>", "Additional member (repeatable)", collectMultiple, [])
      .allowExcessArguments(false),
  ).action(withOutput(runGroupCreateCommand));

  // Named `add-waker` upstream; BySpace calls the entity a worker, so the
  // command is `add-worker` and takes `--worker` for the same reason.
  addJsonAndDaemonHostOptions(
    group
      .command("add-worker")
      .description("Add workers to a group")
      .argument("<group-id>", "Group id")
      .requiredOption("--worker <worker-id>", "Worker to add (repeatable)", collectMultiple, [])
      .option("--role <role>", "Role in the group: member (default) or coordinator", "member")
      .allowExcessArguments(false),
  ).action(withOutput(runGroupAddWorkerCommand));

  addJsonAndDaemonHostOptions(
    group
      .command("remove-worker")
      .description("Remove a worker from a group")
      .argument("<group-id>", "Group id")
      .argument("<worker-id>", "Worker to remove")
      .allowExcessArguments(false),
  ).action(withOutput(runGroupRemoveWorkerCommand));

  return worker;
}
