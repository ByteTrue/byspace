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
import { runGoalCreateCommand, runGoalGetCommand, runGoalMutateCommand } from "./goal.js";
import {
  runInboxListCommand,
  runMessageListCommand,
  runMessageReadCommand,
  runMessageSendCommand,
} from "./message.js";
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

  // Messages mirror the reference product's split: `--mention` wakes the named
  // workers, `--not-mention` stores without waking anyone.
  const message = worker.command("message").description("Messages within a group");

  addJsonAndDaemonHostOptions(
    message
      .command("send")
      .description("Send a message to a group, waking anyone mentioned")
      .requiredOption("--group-id <id>", "Group to send to")
      .requiredOption("--sender-worker-id <id>", "Worker sending it")
      .requiredOption("--body <text>", "Message body")
      .option("--mention <worker-id>", "Waking recipient (repeatable)", collectMultiple, [])
      .option("--not-mention", "Store the message without waking anyone")
      .option(
        "--private-to <worker-id>",
        "Reader when narrower than the group (repeatable)",
        collectMultiple,
        [],
      )
      .option("--intent <intent>", "chat | ask | notify | request_action")
      .option("--reply-to <message-id>", "Message being replied to")
      .allowExcessArguments(false),
  ).action(withOutput(runMessageSendCommand));

  addJsonAndDaemonHostOptions(
    message
      .command("ls")
      .description("Read a group's stream")
      .requiredOption("--group-id <id>", "Group to read")
      .option("--viewer-worker-id <id>", "Only what this worker may read")
      .option("--limit <n>", "Most recent N messages")
      .allowExcessArguments(false),
  ).action(withOutput(runMessageListCommand));

  addJsonAndDaemonHostOptions(
    worker
      .command("inbox")
      .description("Messages that woke a worker and are not finished")
      .requiredOption("--worker-id <id>", "Worker whose inbox to read")
      .allowExcessArguments(false),
  ).action(withOutput(runInboxListCommand));

  addJsonAndDaemonHostOptions(
    message
      .command("read")
      .description("Mark a message finished for one worker")
      .requiredOption("--message-id <id>", "Message to mark")
      .requiredOption("--worker-id <id>", "Worker who read it")
      .allowExcessArguments(false),
  ).action(withOutput(runMessageReadCommand));

  // The group's objective and its budget. A mutation must echo the version the
  // caller read, so two runs cannot silently overwrite each other.
  const goal = worker.command("goal").description("What a group is delivering, and its budget");

  addJsonAndDaemonHostOptions(
    goal
      .command("get")
      .description("Read a group's goal and its current version")
      .requiredOption("--group-id <id>", "Group to read")
      .allowExcessArguments(false),
  ).action(withOutput(runGoalGetCommand));

  addJsonAndDaemonHostOptions(
    goal
      .command("create")
      .description("Set a group's objective and budget")
      .requiredOption("--group-id <id>", "Group to set it on")
      .requiredOption("--content <text>", "The user-facing delivery objective")
      .requiredOption("--turn-limit <n>", "Public message budget, 1..96")
      .allowExcessArguments(false),
  ).action(withOutput(runGoalCreateCommand));

  addJsonAndDaemonHostOptions(
    goal
      .command("mutate")
      .description("Update, complete, pause or reopen a goal")
      .requiredOption("--group-id <id>", "Group the goal belongs to")
      .requiredOption("--action <action>", "update | complete | pause | reopen")
      .requiredOption("--generation <n>", "Generation from `goal get`")
      .requiredOption("--revision <n>", "Revision from `goal get`")
      .option("--content <text>", "New objective (update, reopen)")
      .option("--turn-limit <n>", "New public message budget (update, reopen)")
      .option("--reason <reason>", "Pause reason (pause)")
      .option("--result-message <message-id>", "The message that delivered the result (complete)")
      .allowExcessArguments(false),
  ).action(withOutput(runGoalMutateCommand));

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
