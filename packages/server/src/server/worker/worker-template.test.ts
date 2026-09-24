/**
 * Tests for worker role templates.
 *
 * Two things matter here: a template must fail loudly when it is incomplete
 * rather than assembling a silently truncated role, and the assembled prompt
 * must be a faithful concatenation of the parts with no runtime leakage.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  WORKER_TEMPLATE_PARTS,
  WorkerTemplateIncompleteError,
  WorkerTemplateNotFoundError,
  assembleWorkerSystemPrompt,
  listWorkerTemplateIds,
  loadWorkerTemplate,
  resolveWorkerTemplateRoot,
} from "./worker-template.js";

let root: string;

function writeTemplate(id: string, parts: Record<string, string>): void {
  mkdirSync(path.join(root, id), { recursive: true });
  for (const [name, content] of Object.entries(parts)) {
    writeFileSync(path.join(root, id, `${name}.md`), content);
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "worker-templates-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("worker templates", () => {
  it("loads the shipped dev roles", async () => {
    const ids = await listWorkerTemplateIds(resolveWorkerTemplateRoot());
    // Shipped set is deliberately the development roles only.
    expect(ids).toEqual([
      "backend-engineer",
      "frontend-developer",
      "project-administrator",
      "qa-engineer",
    ]);
  });

  it("loads every shipped template with all parts present", async () => {
    const ids = await listWorkerTemplateIds(resolveWorkerTemplateRoot());
    for (const id of ids) {
      const template = await loadWorkerTemplate(id, resolveWorkerTemplateRoot());
      for (const part of WORKER_TEMPLATE_PARTS) {
        expect(template.parts[part].length, `${id}/${part}`).toBeGreaterThan(0);
      }
      expect(template.title.length).toBeGreaterThan(0);
      // The upstream `common-` / role prefixes must not survive import.
      expect(template.id.startsWith("common-")).toBe(false);
    }
  });

  it("derives the role title from the template's own heading", async () => {
    writeTemplate("frontend-developer", {
      IDENTITY: "# Identity — Frontend Developer\n\nYou build interfaces.",
      PERSONA: "# Persona\n\nDirect.",
      BIBLE: "# Bible\n\nWork carefully.",
    });

    const template = await loadWorkerTemplate("frontend-developer", root);
    expect(template.title).toBe("Frontend Developer");
  });

  it("does not mistake an unrelated heading for the role title", async () => {
    // Some roles use a two-dash separator; the title is still the trailing part.
    writeTemplate("qa-engineer", {
      IDENTITY: "# Identity -- QA Engineer\n\nYou verify.",
      PERSONA: "# Persona\n\nSceptical.",
      BIBLE: "# Bible\n\nEvidence first.",
    });

    const template = await loadWorkerTemplate("qa-engineer", root);
    expect(template.title).toBe("QA Engineer");
  });

  it("reports a missing template distinctly from an incomplete one", async () => {
    await expect(loadWorkerTemplate("nope", root)).rejects.toThrow(WorkerTemplateNotFoundError);

    writeTemplate("broken", { IDENTITY: "# Identity — Broken\n\nx" });
    await expect(loadWorkerTemplate("broken", root)).rejects.toThrow(WorkerTemplateIncompleteError);
  });

  it("names the missing parts so the fix is obvious", async () => {
    writeTemplate("broken", { IDENTITY: "# Identity — Broken\n\nx", PERSONA: "  " });

    await expect(loadWorkerTemplate("broken", root)).rejects.toThrow(
      /BIBLE\.md.*PERSONA\.md|BIBLE\.md/,
    );
  });

  it("assembles the prompt in part order, joined with separators", async () => {
    const template = await loadWorkerTemplate("frontend-developer", resolveWorkerTemplateRoot());
    const prompt = assembleWorkerSystemPrompt(template);

    // Order matters: identity, then persona, then working method.
    const identityAt = prompt.indexOf(template.parts.IDENTITY);
    const personaAt = prompt.indexOf(template.parts.PERSONA);
    const bibleAt = prompt.indexOf(template.parts.BIBLE);
    expect(identityAt).toBe(0);
    expect(personaAt).toBeGreaterThan(identityAt);
    expect(bibleAt).toBeGreaterThan(personaAt);

    expect(prompt).toContain("\n\n---\n\n");
  });

  it("omits capability and delivery documents from the prompt", async () => {
    // These parts exist in the harvested assets but are deliberately not
    // assembled until a worker is seen ignoring its declared capabilities.
    const template = await loadWorkerTemplate("frontend-developer", resolveWorkerTemplateRoot());
    const prompt = assembleWorkerSystemPrompt(template);

    expect(prompt).not.toContain("CORE_CAPABILITIES");
    expect(prompt).not.toContain("DELIVERY_COMMITMENTS");
    expect(prompt).not.toContain("WORK_STYLES");
  });

  it("returns an empty list rather than throwing for a missing root", async () => {
    expect(await listWorkerTemplateIds(path.join(root, "absent"))).toEqual([]);
  });
});
