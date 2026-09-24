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
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** The parts of a role, in the order they are assembled. */
export const WORKER_TEMPLATE_PARTS = ["IDENTITY", "PERSONA", "BIBLE"] as const;

export type WorkerTemplatePart = (typeof WORKER_TEMPLATE_PARTS)[number];

/**
 * Role skills that the upstream assets reference but that are deliberately not
 * imported. Keeping this list explicit means a dangling reference in a template
 * is either a known decision or a test failure, never a silent gap.
 */
export const DELIBERATELY_UNIMPORTED_SKILLS: Readonly<Record<string, string>> = {
  "browser-harness":
    "Vendored third-party browser automation (MIT, Browser Use) whose capability " +
    "BySpace retired on purpose in byissue/issues/032-x-ff-retire-browser-tools.md. " +
    "Re-importing it would reinstate a removed feature, so roles keep the reference " +
    "while the skill stays out.",
};

export interface WorkerTemplate {
  /** Directory name, e.g. `frontend-developer`. */
  id: string;
  /** Human-facing role name, from the first heading of IDENTITY.md. */
  title: string;
  /**
   * One-line summary of the role, from the first paragraph of IDENTITY.md.
   *
   * Derived rather than stored separately so the catalog and the prompt cannot
   * describe the role differently. Empty when the template has no prose under
   * its heading, which the reference products render as no description rather
   * than as a placeholder.
   */
  description: string;
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

/**
 * The role's one-line summary: the first paragraph under the heading.
 *
 * Stops at the first blank line so a long identity document yields one sentence
 * group rather than its whole text.
 */
function extractDescription(identity: string, fallback: string): string {
  const lines = identity.split("\n");
  const start = lines.findIndex((line) => line.trim().length > 0 && !line.startsWith("# "));
  if (start === -1) return fallback;
  const paragraph: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.trim().length === 0) break;
    paragraph.push(line.trim());
  }
  return paragraph.join(" ").trim() || fallback;
}

async function listSkillIds(templateDir: string): Promise<string[]> {
  const skillsDir = path.join(templateDir, "skills");
  const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // A skill directory without SKILL.md is not loadable, so it does not count
    // as present; the reference test would otherwise pass on an empty folder.
    const hasSkillFile = await stat(path.join(skillsDir, entry.name, "SKILL.md"))
      .then((s) => s.isFile())
      .catch(() => false);
    if (hasSkillFile) ids.push(entry.name);
  }
  return ids.sort();
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
    description: extractDescription(parts.IDENTITY, ""),
    parts,
    skills: await listSkillIds(templateDir),
  };
}

export async function listWorkerTemplateIds(
  root: string = resolveWorkerTemplateRoot(),
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Skills a template's own BIBLE tells the worker to invoke, by name.
 *
 * The upstream templates reference skills as `` `skill <name>` ``. Parsing them
 * lets a test assert the reference is satisfiable instead of trusting that
 * import and prose stayed in step.
 */
export function extractReferencedSkillIds(bible: string): string[] {
  const referenced = new Set<string>();
  for (const match of bible.matchAll(/`skill ([a-z0-9-]+)`/g)) {
    referenced.add(match[1]!);
  }
  return [...referenced].sort();
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
