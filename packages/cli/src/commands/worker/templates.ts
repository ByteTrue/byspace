import type { Command } from "commander";
import type { CommandOptions, ListResult, OutputSchema } from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";

export interface WorkerTemplateRow {
  templateId: string;
  title: string;
  skills: string;
}

const schema: OutputSchema<WorkerTemplateRow> = {
  idField: "templateId",
  columns: [
    { header: "TEMPLATE ID", field: "templateId", width: 24 },
    { header: "TITLE", field: "title", width: 26 },
    { header: "SKILLS", field: "skills", width: 44 },
  ],
};

/**
 * The roles a worker can be created with.
 *
 * A worker's role is fixed at creation, so this is the list to consult before
 * `worker create` rather than after a failed one.
 */
export async function runWorkerTemplateLsCommand(
  options: CommandOptions,
  _command: Command,
): Promise<ListResult<WorkerTemplateRow>> {
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });

  try {
    const payload = await client.listWorkerTemplates();
    return {
      type: "list",
      data: payload.templates.map((template) => ({
        templateId: template.id,
        title: template.title,
        skills: template.skills.join(", "),
      })),
      schema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
