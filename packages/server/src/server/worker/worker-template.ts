/**
 * Worker role templates: what a worker is, expressed as files.
 *
 * A template is a directory of Markdown parts. The admin surface edits the
 * files; the runtime assembles the system prompt. Keeping the parts separate
 * means a reviewer can see which half of a worker's behaviour a change touches
 * (who it is vs. how it talks vs. how it works) instead of diffing one growing
 * prompt string.
 *
 * Part names and their split are taken from QoderWake's worker layout. See
 * byissue/talks/003-worker-domain-qoderwake-reference.md for the provenance and
 * the licensing note on that product's own assets.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The parts of a role, in the order they are assembled. */
export const WORKER_TEMPLATE_PARTS = ["IDENTITY", "PERSONA", "BIBLE"] as const;

export type WorkerTemplatePart = (typeof WORKER_TEMPLATE_PARTS)[number];

export interface WorkerTemplate {
  /** Directory name, e.g. `frontend-developer`. */
  id: string;
  /** Human-facing role name, from the first heading of IDENTITY.md. */
  title: string;
  parts: Record<WorkerTemplatePart, string>;
  /** Role-specific skill directories shipped alongside the template. */
  skills: string[];
}

export class WorkerTemplateNotFoundError extends Error {
  constructor(id: string, root: string) {
    super(`Worker template '${id}' not found under ${root}.`);
    this.name = "WorkerTemplateNotFoundError";
  }
}

export class WorkerTemplateIncompleteError extends Error {
  constructor(id: string, missing: readonly string[]) {
    super(`Worker template '${id}' is missing required parts: ${missing.join(", ")}.`);
    this.name = "WorkerTemplateIncompleteError";
  }
}

export function resolveWorkerTemplateRoot(): string {
  // Templates ship with the server build, next to the compiled module.
  return path.join(path.dirname(new URL(import.meta.url).pathname), "templates");
}

/**
 * Role title from the template's own heading, so the catalog and the prompt
 * cannot disagree about what a role is called.
 */
function extractTitle(identity: string, fallback: string): string {
  const heading = identity.split("\n").find((line) => line.startsWith("# "));
  if (!heading) return fallback;
  // Headings read like "# Identity — Frontend Developer" or "# Identity -- QA".
  const afterDash = heading.replace(/^#\s+/, "").split(/—|--/);
  const title = (afterDash.length > 1 ? afterDash[afterDash.length - 1] : afterDash[0]).trim();
  return title.length > 0 ? title : fallback;
}

export async function loadWorkerTemplate(
  id: string,
  root: string = resolveWorkerTemplateRoot(),
): Promise<WorkerTemplate> {
  const templateDir = path.join(root, id);
  const parts = {} as Record<WorkerTemplatePart, string>;
  const missing: string[] = [];

  for (const part of WORKER_TEMPLATE_PARTS) {
    const filePath = path.join(templateDir, `${part}.md`);
    try {
      const content = (await readFile(filePath, "utf8")).trim();
      if (content.length === 0) {
        missing.push(`${part}.md (empty)`);
        continue;
      }
      parts[part] = content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // A missing IDENTITY is a missing template; a missing part is an
        // incomplete one. Distinguish so the message points at the real fix.
        if (part === "IDENTITY") throw new WorkerTemplateNotFoundError(id, root);
        missing.push(`${part}.md`);
        continue;
      }
      throw error;
    }
  }

  if (missing.length > 0) {
    throw new WorkerTemplateIncompleteError(id, missing);
  }

  return {
    id,
    title: extractTitle(parts.IDENTITY, id),
    parts,
    skills: [],
  };
}

export async function listWorkerTemplateIds(
  root: string = resolveWorkerTemplateRoot(),
): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Assemble the system prompt that defines a worker for its runtime.
 *
 * Only the identity parts are assembled. Capability lists and delivery
 * contracts stay out of the prompt until a worker is observed acting against
 * its declared capabilities; until then they would spend context on claims the
 * model cannot act on differently.
 */
export function assembleWorkerSystemPrompt(template: WorkerTemplate): string {
  return WORKER_TEMPLATE_PARTS.filter((part) => template.parts[part])
    .map((part) => template.parts[part])
    .join("\n\n---\n\n")
    .trim();
}
